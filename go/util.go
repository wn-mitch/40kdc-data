package wh40kdc

import (
	"strconv"
	"strings"
)

func itoa(n int) string { return strconv.Itoa(n) }

func lower(s string) string { return strings.ToLower(s) }

func lowerAll(xs []string) []string {
	out := make([]string, len(xs))
	for i, x := range xs {
		out[i] = strings.ToLower(x)
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func anyIn(set map[string]struct{}, xs []string) bool {
	for _, x := range xs {
		if _, ok := set[x]; ok {
			return true
		}
	}
	return false
}

func allIn(set map[string]struct{}, xs []string) bool {
	for _, x := range xs {
		if _, ok := set[x]; !ok {
			return false
		}
	}
	return true
}
