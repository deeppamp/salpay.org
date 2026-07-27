package conf

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "test.conf")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoad(t *testing.T) {
	p := write(t, `
# lighthouse account
LIGHTHOUSE_API_KEY = abc123
LIGHTHOUSE_API_URL="https://api.example"
EMPTY_OK=
QUOTED='single'
`)
	vals, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"LIGHTHOUSE_API_KEY": "abc123",
		"LIGHTHOUSE_API_URL": "https://api.example",
		"EMPTY_OK":           "",
		"QUOTED":             "single",
	}
	for k, v := range want {
		if vals[k] != v {
			t.Errorf("%s = %q, want %q", k, vals[k], v)
		}
	}

	if _, err := Load(write(t, "no equals sign")); err == nil {
		t.Fatal("malformed line accepted")
	}
	if _, err := Load(filepath.Join(t.TempDir(), "missing")); !os.IsNotExist(err) {
		t.Fatalf("want not-exist, got %v", err)
	}
}

func TestApplyEnvWins(t *testing.T) {
	p := write(t, "CONF_TEST_A=file\nCONF_TEST_B=file\n")
	t.Setenv("CONF_TEST_A", "env")
	t.Setenv("CONF_TEST_B", "")
	if err := Apply(p); err != nil {
		t.Fatal(err)
	}
	if got := os.Getenv("CONF_TEST_A"); got != "env" {
		t.Fatalf("env did not win: %q", got)
	}
	if got := os.Getenv("CONF_TEST_B"); got != "file" {
		t.Fatalf("empty env not filled from file: %q", got)
	}
}
