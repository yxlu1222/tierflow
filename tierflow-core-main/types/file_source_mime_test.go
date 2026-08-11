package types

import "testing"

func TestDataURLMimeType(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"pdf with base64 marker", "data:application/pdf;base64,JVBERi0x", "application/pdf"},
		{"png with base64 marker", "data:image/png;base64,iVBORw0K", "image/png"},
		{"no encoding marker", "data:text/plain,hello", "text/plain"},
		{"charset parameter", "data:text/plain;charset=utf-8;base64,aGk=", "text/plain"},
		{"empty mime", "data:;base64,aGk=", ""},
		{"not a data url", "iVBORw0KGgoAAAANSUhEUg==", ""},
		{"http url", "https://example.com/a.pdf", ""},
		{"malformed, no comma", "data:application/pdf;base64", ""},
		{"empty string", "", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := DataURLMimeType(tc.in); got != tc.want {
				t.Errorf("DataURLMimeType(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
