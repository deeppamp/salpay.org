package web

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/deeppamp/salpay.org/salpay/manager/accounts"
	"github.com/deeppamp/salpay.org/salpay/manager/img"
	"github.com/deeppamp/salpay.org/salpay/manager/imgproc"
	"github.com/deeppamp/salpay.org/salpay/manager/invoice"
	"github.com/deeppamp/salpay.org/salpay/manager/registry"
	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
)

//go:embed templates/*.html
var templateFS embed.FS

const sessionCookie = "session"

type Config struct {
	Zone         string
	CookieSecure bool
	FeeShort     uint64
	FeeMid       uint64
	FeeLong      uint64
	FeeSlots     uint64
}

type Server struct {
	cfg Config
	acc *accounts.Accounts
	reg *registry.Registry
	mgr *invoice.Manager
	tpl *template.Template
}

func New(cfg Config, acc *accounts.Accounts, reg *registry.Registry, mgr *invoice.Manager) (*Server, error) {
	tpl, err := template.New("").Funcs(template.FuncMap{"sal": FormatSAL}).ParseFS(templateFS, "templates/*.html")
	if err != nil {
		return nil, err
	}
	return &Server{cfg: cfg, acc: acc, reg: reg, mgr: mgr, tpl: tpl}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.home)
	mux.HandleFunc("GET /signup", s.signupForm)
	mux.HandleFunc("POST /signup", s.signup)
	mux.HandleFunc("GET /login", s.loginForm)
	mux.HandleFunc("POST /login", s.login)
	mux.HandleFunc("POST /logout", s.logout)
	mux.HandleFunc("GET /buy", s.buyForm)
	mux.HandleFunc("POST /buy", s.buy)
	mux.HandleFunc("GET /invoice/{id}", s.invoicePage)
	mux.HandleFunc("GET /account", s.account)
	mux.HandleFunc("GET /name/{label}", s.namePage)
	mux.HandleFunc("POST /name/{label}/address", s.updateAddress)
	mux.HandleFunc("POST /name/{label}/images", s.uploadImage)
	mux.HandleFunc("GET /name/{label}/images/{id}/raw", s.imagePreview)
	mux.HandleFunc("POST /name/{label}/images/{id}/activate", s.activateImage)
	mux.HandleFunc("POST /name/{label}/images/{id}/delete", s.deleteImage)
	mux.HandleFunc("POST /name/{label}/images/reset", s.resetImage)
	mux.HandleFunc("POST /name/{label}/slots", s.buySlots)
	mux.HandleFunc("GET /api/availability", s.apiAvailability)
	mux.HandleFunc("GET /api/invoice/{id}", s.apiInvoice)
	mux.HandleFunc("GET /api/invoice/{id}/qr.png", s.apiInvoiceQR)
	return mux
}

func FormatSAL(atomic uint64) string {
	whole := atomic / walletrpc.AtomicUnits
	frac := atomic % walletrpc.AtomicUnits
	if frac == 0 {
		return fmt.Sprintf("%d", whole)
	}
	return fmt.Sprintf("%d.%s", whole, strings.TrimRight(fmt.Sprintf("%08d", frac), "0"))
}

func (s *Server) feeFor(label string) uint64 {
	switch n := len(label); {
	case n <= 4:
		return s.cfg.FeeShort
	case n <= 6:
		return s.cfg.FeeMid
	default:
		return s.cfg.FeeLong
	}
}

type baseData struct {
	User  *accounts.User
	Error string
}

func (s *Server) base(r *http.Request) baseData {
	if u, ok := s.user(r); ok {
		return baseData{User: &u}
	}
	return baseData{}
}

func (s *Server) user(r *http.Request) (accounts.User, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return accounts.User{}, false
	}
	u, err := s.acc.UserByToken(r.Context(), c.Value)
	if err != nil {
		return accounts.User{}, false
	}
	return u, true
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (accounts.User, bool) {
	u, ok := s.user(r)
	if !ok {
		http.Redirect(w, r, "/login", http.StatusFound)
	}
	return u, ok
}

func (s *Server) setSession(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) render(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.tpl.ExecuteTemplate(w, name, data); err != nil {
		http.Error(w, "template error", http.StatusInternalServerError)
	}
}

func userMessage(err error) string {
	switch {
	case errors.Is(err, accounts.ErrEmailTaken):
		return "email already registered"
	case errors.Is(err, accounts.ErrBadCredentials):
		return "wrong email or password"
	case errors.Is(err, accounts.ErrInvalid), errors.Is(err, registry.ErrInvalid):
		return err.Error()
	case errors.Is(err, registry.ErrTaken):
		return "name is taken"
	case errors.Is(err, registry.ErrForbidden):
		return "not your name"
	case errors.Is(err, registry.ErrNoSlots):
		return "image slots full, buy more below"
	case errors.Is(err, registry.ErrNotFound):
		return "name not found"
	default:
		return "internal error"
	}
}

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	s.render(w, "home", s.base(r))
}

func (s *Server) signupForm(w http.ResponseWriter, r *http.Request) {
	s.render(w, "signup", s.base(r))
}

func (s *Server) signup(w http.ResponseWriter, r *http.Request) {
	email := r.FormValue("email")
	password := r.FormValue("password")
	if _, err := s.acc.Register(r.Context(), email, password); err != nil {
		s.render(w, "signup", baseData{Error: userMessage(err)})
		return
	}
	sess, err := s.acc.Login(r.Context(), email, password)
	if err != nil {
		s.render(w, "login", baseData{Error: userMessage(err)})
		return
	}
	s.setSession(w, sess.Token, sess.ExpiresAt)
	http.Redirect(w, r, "/account", http.StatusSeeOther)
}

func (s *Server) loginForm(w http.ResponseWriter, r *http.Request) {
	s.render(w, "login", s.base(r))
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	sess, err := s.acc.Login(r.Context(), r.FormValue("email"), r.FormValue("password"))
	if err != nil {
		s.render(w, "login", baseData{Error: userMessage(err)})
		return
	}
	s.setSession(w, sess.Token, sess.ExpiresAt)
	http.Redirect(w, r, "/account", http.StatusSeeOther)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.acc.Logout(r.Context(), c.Value)
	}
	s.setSession(w, "", time.Unix(0, 0))
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

type buyData struct {
	baseData
	Label     string
	FeeAtomic uint64
}

func (s *Server) buyForm(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	label, err := registry.NormalizeLabel(r.URL.Query().Get("name"))
	if err != nil {
		s.render(w, "home", baseData{User: &u, Error: "invalid name"})
		return
	}
	available, err := s.reg.Available(r.Context(), label)
	if err != nil || !available {
		s.render(w, "home", baseData{User: &u, Error: label + ".sal is not available"})
		return
	}
	s.render(w, "buy", buyData{baseData{User: &u}, label, s.feeFor(label)})
}

func (s *Server) buy(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	label, err := registry.NormalizeLabel(r.FormValue("name"))
	if err != nil {
		s.render(w, "home", baseData{User: &u, Error: "invalid name"})
		return
	}
	res, err := s.reg.Reserve(r.Context(), u.ID, label, strings.TrimSpace(r.FormValue("address")), s.feeFor(label))
	if err != nil {
		s.render(w, "buy", buyData{baseData{User: &u, Error: userMessage(err)}, label, s.feeFor(label)})
		return
	}
	http.Redirect(w, r, "/invoice/"+res.Invoice.ID, http.StatusSeeOther)
}

type invoiceData struct {
	baseData
	Inv invoice.Invoice
	Ctx registry.InvoiceContext
}

// invoiceFor gates invoice access to the owner without leaking existence.
func (s *Server) invoiceFor(w http.ResponseWriter, r *http.Request, u accounts.User) (registry.InvoiceContext, invoice.Invoice, bool) {
	id := r.PathValue("id")
	ic, err := s.reg.InvoiceContext(r.Context(), id)
	if err != nil || ic.OwnerID != u.ID {
		http.NotFound(w, r)
		return registry.InvoiceContext{}, invoice.Invoice{}, false
	}
	inv, err := s.mgr.Get(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return registry.InvoiceContext{}, invoice.Invoice{}, false
	}
	return ic, inv, true
}

func (s *Server) invoicePage(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	ic, inv, ok := s.invoiceFor(w, r, u)
	if !ok {
		return
	}
	s.render(w, "invoice", invoiceData{baseData{User: &u}, inv, ic})
}

func (s *Server) apiInvoice(w http.ResponseWriter, r *http.Request) {
	u, ok := s.user(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ic, inv, ok := s.invoiceFor(w, r, u)
	if !ok {
		return
	}
	writeJSON(w, map[string]any{
		"status":          inv.Status,
		"kind":            ic.Kind,
		"amount_atomic":   inv.AmountAtomic,
		"received_atomic": inv.ReceivedAtomic,
		"amount_sal":      FormatSAL(inv.AmountAtomic),
		"label":           ic.Label,
		"fulfilled":       inv.FulfilledAt != nil,
		"expires_at":      inv.ExpiresAt,
	})
}

func (s *Server) apiInvoiceQR(w http.ResponseWriter, r *http.Request) {
	u, ok := s.user(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	_, inv, ok := s.invoiceFor(w, r, u)
	if !ok {
		return
	}
	png, err := img.QRPNG(inv.Subaddress)
	if err != nil {
		http.Error(w, "image generation failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(png)
}

type accountData struct {
	baseData
	Names []registry.Name
}

func (s *Server) account(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	names, err := s.reg.NamesByOwner(r.Context(), u.ID)
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	s.render(w, "account", accountData{baseData{User: &u}, names})
}

type nameData struct {
	baseData
	Name      registry.Name
	Images    []registry.Image
	HasActive bool
	FeeSlots  uint64
	SlotPack  int
	Message   string
}

var nameMessages = map[string]string{
	"updated":       "address updated",
	"img-added":     "image added",
	"img-activated": "image activated",
	"img-deleted":   "image deleted",
	"img-reset":     "back to the qr default",
}

func (s *Server) loadName(r *http.Request, u accounts.User, label string) (nameData, error) {
	name, err := s.reg.Lookup(r.Context(), label)
	if err != nil {
		return nameData{}, err
	}
	if name.OwnerID != u.ID {
		return nameData{}, registry.ErrForbidden
	}
	images, err := s.reg.Images(r.Context(), u.ID, name.Label)
	if err != nil {
		return nameData{}, err
	}
	d := nameData{
		baseData: baseData{User: &u},
		Name:     name,
		Images:   images,
		FeeSlots: s.cfg.FeeSlots,
		SlotPack: registry.SlotPack,
	}
	for _, im := range images {
		if im.Active {
			d.HasActive = true
		}
	}
	return d, nil
}

func (s *Server) namePage(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	d, err := s.loadName(r, u, r.PathValue("label"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	d.Message = nameMessages[r.URL.Query().Get("msg")]
	s.render(w, "name", d)
}

// renderNameError re-renders the name page with a message from a failed
// mutation, falling back to 404 when the page itself cannot load.
func (s *Server) renderNameError(w http.ResponseWriter, r *http.Request, u accounts.User, label string, opErr error) {
	d, err := s.loadName(r, u, label)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	d.Error = userMessage(opErr)
	s.render(w, "name", d)
}

func (s *Server) updateAddress(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	label := r.PathValue("label")
	name, err := s.reg.UpdateAddress(r.Context(), u.ID, label, strings.TrimSpace(r.FormValue("address")))
	if err != nil {
		s.renderNameError(w, r, u, label, err)
		return
	}
	http.Redirect(w, r, "/name/"+name.Label+"?msg=updated", http.StatusSeeOther)
}

func (s *Server) uploadImage(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	label := r.PathValue("label")
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		s.renderNameError(w, r, u, label, registry.ErrInvalid)
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		s.renderNameError(w, r, u, label, registry.ErrInvalid)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, imgproc.MaxBytes+1))
	if err != nil {
		s.renderNameError(w, r, u, label, registry.ErrInvalid)
		return
	}
	if _, err := s.reg.AddImage(r.Context(), u.ID, label, data); err != nil {
		s.renderNameError(w, r, u, label, err)
		return
	}
	http.Redirect(w, r, "/name/"+label+"?msg=img-added", http.StatusSeeOther)
}

func (s *Server) imagePreview(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	data, contentType, err := s.reg.ImageData(r.Context(), u.ID, r.PathValue("label"), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	img.WriteImage(w, data, contentType)
}

func (s *Server) activateImage(w http.ResponseWriter, r *http.Request) {
	s.imageAction(w, r, "img-activated", func(u accounts.User, label string, id int64) error {
		return s.reg.ActivateImage(r.Context(), u.ID, label, id)
	})
}

func (s *Server) deleteImage(w http.ResponseWriter, r *http.Request) {
	s.imageAction(w, r, "img-deleted", func(u accounts.User, label string, id int64) error {
		return s.reg.DeleteImage(r.Context(), u.ID, label, id)
	})
}

func (s *Server) imageAction(w http.ResponseWriter, r *http.Request, msg string, op func(accounts.User, string, int64) error) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	label := r.PathValue("label")
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if err := op(u, label, id); err != nil {
		s.renderNameError(w, r, u, label, err)
		return
	}
	http.Redirect(w, r, "/name/"+label+"?msg="+msg, http.StatusSeeOther)
}

func (s *Server) resetImage(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	label := r.PathValue("label")
	if err := s.reg.ResetImage(r.Context(), u.ID, label); err != nil {
		s.renderNameError(w, r, u, label, err)
		return
	}
	http.Redirect(w, r, "/name/"+label+"?msg=img-reset", http.StatusSeeOther)
}

func (s *Server) buySlots(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	label := r.PathValue("label")
	inv, err := s.reg.BuySlots(r.Context(), u.ID, label, s.cfg.FeeSlots)
	if err != nil {
		s.renderNameError(w, r, u, label, err)
		return
	}
	http.Redirect(w, r, "/invoice/"+inv.ID, http.StatusSeeOther)
}

func (s *Server) apiAvailability(w http.ResponseWriter, r *http.Request) {
	label, err := registry.NormalizeLabel(r.URL.Query().Get("name"))
	if err != nil {
		writeJSON(w, map[string]any{"valid": false})
		return
	}
	available, err := s.reg.Available(r.Context(), label)
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	fee := s.feeFor(label)
	writeJSON(w, map[string]any{
		"valid":      true,
		"label":      label,
		"available":  available,
		"fee_atomic": fee,
		"fee_sal":    FormatSAL(fee),
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
