package main

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/deeppamp/salpay.org/salpay/manager/accounts"
	"github.com/deeppamp/salpay.org/salpay/manager/conf"
	"github.com/deeppamp/salpay.org/salpay/manager/dns"
	"github.com/deeppamp/salpay.org/salpay/manager/img"
	"github.com/deeppamp/salpay.org/salpay/manager/invoice"
	"github.com/deeppamp/salpay.org/salpay/manager/pin"
	"github.com/deeppamp/salpay.org/salpay/manager/registry"
	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
	"github.com/deeppamp/salpay.org/salpay/manager/web"
)

const defaultConf = "/srv/sal.cash/aliasd.conf"

func main() {
	confPath := getenv("ALIASD_CONF", defaultConf)
	if err := conf.Apply(confPath); err != nil && !(os.IsNotExist(err) && confPath == defaultConf) {
		log.Fatal(err)
	}

	listen := getenv("LISTEN_ADDR", ":8080")
	dbPath := getenv("DB_PATH", "manager.db")
	zone := getenv("ZONE", "sal.cash")
	minConf := envUint(getenv("MIN_CONFIRMATIONS", "1"))
	reservationTTL := envDuration(getenv("RESERVATION_TTL", "30m"))
	sessionTTL := envDuration(getenv("SESSION_TTL", "720h"))
	sessionIdle := envDuration(getenv("SESSION_IDLE_TTL", "30m"))
	pollInterval := envDuration(getenv("POLL_INTERVAL", "15s"))
	cookieSecure := getenv("COOKIE_SECURE", "false") == "true"

	if len(os.Args) > 1 && os.Args[1] == "support-check" {
		supportCheck(dbPath, sessionTTL, sessionIdle, os.Args[2:])
		return
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}

	var wallet walletrpc.Wallet
	if url := os.Getenv("WALLET_RPC_URL"); url != "" {
		wallet = walletrpc.New(url)
	} else {
		log.Print("WALLET_RPC_URL missing, using mock wallet")
		wallet = walletrpc.NewMock()
	}

	var writer dns.Writer
	if token, zoneID := os.Getenv("CF_API_TOKEN"), os.Getenv("CF_ZONE_ID"); token != "" && zoneID != "" {
		writer = dns.NewCloudflare(token, zoneID)
	} else {
		log.Print("CF_API_TOKEN or CF_ZONE_ID missing, using mock dns writer")
		writer = dns.NewMock()
	}

	var pinner pin.Pinner
	account, keyID, secret, bucket := os.Getenv("R2_ACCOUNT_ID"), os.Getenv("R2_ACCESS_KEY_ID"),
		os.Getenv("R2_SECRET_ACCESS_KEY"), os.Getenv("R2_BUCKET")
	if account != "" && keyID != "" && secret != "" && bucket != "" {
		pinner = pin.NewR2(account, keyID, secret, bucket)
	} else {
		log.Print("R2_* config missing, using mock pinner")
		pinner = pin.NewMock()
	}

	mgr, err := invoice.New(db, wallet, minConf, reservationTTL)
	if err != nil {
		log.Fatal(err)
	}
	reg, err := registry.New(db, mgr, writer, pinner, zone)
	if err != nil {
		log.Fatal(err)
	}
	acc, err := accounts.New(db, sessionTTL, sessionIdle)
	if err != nil {
		log.Fatal(err)
	}

	srv, err := web.New(web.Config{
		Zone:         zone,
		CookieSecure: cookieSecure,
		AddressDelay: envDuration(getenv("ADDRESS_CHANGE_DELAY", "30m")),
		FeeShort:     envUint(getenv("FEE_SHORT_SAL", "2000")) * walletrpc.AtomicUnits,
		FeeMid:       envUint(getenv("FEE_MID_SAL", "500")) * walletrpc.AtomicUnits,
		FeeLong:      envUint(getenv("FEE_LONG_SAL", "100")) * walletrpc.AtomicUnits,
		FeeSlots:     envUint(getenv("FEE_SLOTS_SAL", "20")) * walletrpc.AtomicUnits,
	}, acc, reg, mgr)
	if err != nil {
		log.Fatal(err)
	}

	if !cookieSecure {
		log.Print("COOKIE_SECURE=false, set true behind tls in production")
	}

	ctx := context.Background()
	go mgr.Run(ctx, pollInterval)
	go reg.Run(ctx, pollInterval)

	mux := http.NewServeMux()
	mux.Handle("/img/", img.NewHandler(reg))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.Handle("/", srv.Handler())

	log.Printf("aliasd listening on %s, zone %s", listen, zone)
	log.Fatal(http.ListenAndServe(listen, web.NewNameHost(reg, zone, mux)))
}

// supportCheck verifies a caller's support phrase: aliasd support-check
// <username>, phrase read from stdin so it stays out of shell history.
func supportCheck(dbPath string, sessionTTL, sessionIdle time.Duration, args []string) {
	if len(args) != 1 {
		log.Fatal("usage: aliasd support-check <username>")
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	acc, err := accounts.New(db, sessionTTL, sessionIdle)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Fprint(os.Stderr, "phrase: ")
	phrase, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		log.Fatal(err)
	}
	ok, err := acc.CheckSupportPhrase(context.Background(), args[0], strings.TrimSpace(phrase))
	if err != nil {
		log.Fatal(err)
	}
	if !ok {
		fmt.Println("NO MATCH")
		os.Exit(1)
	}
	fmt.Println("match")
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envUint(v string) uint64 {
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		log.Fatalf("invalid numeric env value %q", v)
	}
	return n
}

func envDuration(v string) time.Duration {
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Fatalf("invalid duration env value %q", v)
	}
	return d
}
