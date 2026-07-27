// Package conf loads key=value config files like /srv/sal.cash/lighthouse.conf.
package conf

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// Load parses a file of KEY=value lines, ignoring blanks and # comments.
func Load(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	vals := map[string]string{}
	sc := bufio.NewScanner(f)
	line := 0
	for sc.Scan() {
		line++
		s := strings.TrimSpace(sc.Text())
		if s == "" || strings.HasPrefix(s, "#") {
			continue
		}
		key, val, ok := strings.Cut(s, "=")
		if !ok {
			return nil, fmt.Errorf("%s:%d: not KEY=value", path, line)
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if len(val) >= 2 && (val[0] == '"' && val[len(val)-1] == '"' || val[0] == '\'' && val[len(val)-1] == '\'') {
			val = val[1 : len(val)-1]
		}
		if key == "" {
			return nil, fmt.Errorf("%s:%d: empty key", path, line)
		}
		vals[key] = val
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return vals, nil
}

// Apply exports the file into the environment; existing env vars win, so a
// container env or systemd EnvironmentFile overrides the file.
func Apply(path string) error {
	vals, err := Load(path)
	if err != nil {
		return err
	}
	for key, val := range vals {
		if os.Getenv(key) == "" {
			if err := os.Setenv(key, val); err != nil {
				return err
			}
		}
	}
	return nil
}
