package registry

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"github.com/deeppamp/salpay.org/salpay/manager/walletrpc"
)

func tinyPNG(t *testing.T, shade uint8) []byte {
	t.Helper()
	m := image.NewRGBA(image.Rect(0, 0, 2, 2))
	m.Set(0, 0, color.RGBA{R: shade, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, m); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestImageLibraryFlow(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, writer := testRegistry(t)
	mint(t, r, mgr, wallet, "alice")

	first, err := r.AddImage(ctx, 1, "alice", tinyPNG(t, 10))
	if err != nil {
		t.Fatal(err)
	}
	if !first.Active || first.CID == "" {
		t.Fatalf("first image must auto activate: %+v", first)
	}
	record := writer.Records["alice.salpay.org"]
	if !strings.Contains(record, "cid="+first.CID) || !strings.Contains(record, "seq=2") {
		t.Fatalf("record missing cid: %q", record)
	}

	data, contentType, ok, err := r.ActiveImage(ctx, "alice")
	if err != nil || !ok || contentType != "image/png" || len(data) == 0 {
		t.Fatalf("active image: ok=%v type=%q err=%v", ok, contentType, err)
	}

	second, err := r.AddImage(ctx, 1, "alice", tinyPNG(t, 20))
	if err != nil {
		t.Fatal(err)
	}
	if second.Active {
		t.Fatal("second image must not steal active")
	}

	if err := r.ActivateImage(ctx, 1, "alice", second.ID); err != nil {
		t.Fatal(err)
	}
	record = writer.Records["alice.salpay.org"]
	if !strings.Contains(record, "cid="+second.CID) || !strings.Contains(record, "seq=3") {
		t.Fatalf("record not switched: %q", record)
	}

	if err := r.DeleteImage(ctx, 1, "alice", second.ID); err != nil {
		t.Fatal(err)
	}
	record = writer.Records["alice.salpay.org"]
	if strings.Contains(record, "cid=") {
		t.Fatalf("deleting active image must drop cid: %q", record)
	}
	if _, _, ok, _ := r.ActiveImage(ctx, "alice"); ok {
		t.Fatal("active image must be gone")
	}

	images, err := r.Images(ctx, 1, "alice")
	if err != nil || len(images) != 1 || images[0].ID != first.ID {
		t.Fatalf("library after delete: %+v err %v", images, err)
	}
}

func TestImageSlotsEnforcedAndPurchasable(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "bob")

	for i := 0; i < 5; i++ {
		if _, err := r.AddImage(ctx, 1, "bob", tinyPNG(t, uint8(i))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := r.AddImage(ctx, 1, "bob", tinyPNG(t, 99)); !errors.Is(err, ErrNoSlots) {
		t.Fatalf("want ErrNoSlots, got %v", err)
	}

	inv, err := r.BuySlots(ctx, 1, "bob", 20*walletrpc.AtomicUnits)
	if err != nil {
		t.Fatal(err)
	}
	ic, err := r.InvoiceContext(ctx, inv.ID)
	if err != nil || ic.Label != "bob" || ic.OwnerID != 1 {
		t.Fatalf("invoice context: %+v err %v", ic, err)
	}

	wallet.Pay(inv.SubaddrIndex, 20*walletrpc.AtomicUnits, 3)
	if err := mgr.Settle(ctx); err != nil {
		t.Fatal(err)
	}

	name, _ := r.Lookup(ctx, "bob")
	if name.ImageSlots != 10 {
		t.Fatalf("slots after purchase: %d", name.ImageSlots)
	}
	if _, err := r.AddImage(ctx, 1, "bob", tinyPNG(t, 99)); err != nil {
		t.Fatalf("sixth image after slot purchase: %v", err)
	}

	// Fulfillment retry must not double apply.
	if err := r.fulfillSlots(ctx, inv); err != nil {
		t.Fatal(err)
	}
	name, _ = r.Lookup(ctx, "bob")
	if name.ImageSlots != 10 {
		t.Fatalf("slots after refulfill: %d", name.ImageSlots)
	}
}

func TestImageOwnershipGating(t *testing.T) {
	ctx := context.Background()
	r, mgr, wallet, _ := testRegistry(t)
	mint(t, r, mgr, wallet, "carol")

	img, err := r.AddImage(ctx, 1, "carol", tinyPNG(t, 1))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := r.AddImage(ctx, 2, "carol", tinyPNG(t, 2)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("want ErrForbidden add, got %v", err)
	}
	if _, err := r.Images(ctx, 2, "carol"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("want ErrForbidden list, got %v", err)
	}
	if err := r.DeleteImage(ctx, 2, "carol", img.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("want ErrForbidden delete, got %v", err)
	}
	if _, _, err := r.ImageData(ctx, 2, "carol", img.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("want ErrForbidden data, got %v", err)
	}
}
