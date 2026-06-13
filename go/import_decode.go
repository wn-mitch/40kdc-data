package wh40kdc

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
)

// Decode a ListForge share payload (base64(gzip(utf8(json)))) embedded in a URL
// hash, a bare base64 segment, or raw JSON. Go mirror of
// python .../imports/decode.py.

const gzipBase64Prefix = "H4sIA"
const listforgeMarker = "/listforge/"

var urlRe = regexp.MustCompile(`(?i)^https?://`)

func extractSegment(input string) string {
	if idx := strings.Index(input, listforgeMarker); idx != -1 {
		return input[idx+len(listforgeMarker):]
	}
	if urlRe.MatchString(input) {
		if i := strings.LastIndex(input, "/"); i != -1 {
			return input[i+1:]
		}
	}
	return input
}

func decodeListforge(input string) (any, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return nil, errors.New("decode_listforge: empty input")
	}
	if strings.HasPrefix(trimmed, "{") {
		var v any
		if err := json.Unmarshal([]byte(trimmed), &v); err != nil {
			return nil, err
		}
		return v, nil
	}
	segment := extractSegment(trimmed)
	if !strings.HasPrefix(segment, gzipBase64Prefix) {
		return nil, errors.New("decode_listforge: input is not a ListForge payload")
	}
	raw, err := base64.StdEncoding.DecodeString(segment)
	if err != nil {
		return nil, errors.New("decode_listforge: failed to gunzip base64 payload")
	}
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("decode_listforge: failed to gunzip base64 payload")
	}
	defer zr.Close()
	payload, err := io.ReadAll(zr)
	if err != nil {
		return nil, errors.New("decode_listforge: failed to gunzip base64 payload")
	}
	var v any
	if err := json.Unmarshal(payload, &v); err != nil {
		return nil, err
	}
	return v, nil
}
