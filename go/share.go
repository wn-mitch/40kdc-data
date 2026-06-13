package wh40kdc

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
)

// Compact, URL-safe list sharing. encodeShareToken packs a share list into a
// share-v1 token (registry-indexed unsigned-LEB128 varints, base64url, no
// gzip); decodeShareToken reverses it against the embedded registry. Go mirror
// of python .../share.py; pinned by conformance/share byte-for-byte.

const shareFormatVersion = 1

const (
	flagWarlord = 1 << 0
	flagEnh     = 1 << 1
	flagAttach  = 1 << 2
	flagAlly    = 1 << 3
	flagGrants  = 1 << 4
)

var battleSizes = []string{"incursion", "strike-force"}

var shareKinds = []string{"faction", "detachment", "unit", "wargear", "enhancement", "ally_rule", "disposition"}

var errShareEncode = errors.New("share encode: id absent from registry")
var errMalformed = errors.New("malformed")
var errStaleRegistry = errors.New("stale-registry")

type registryIndex struct {
	version   int
	toIndex   map[string]map[string]int
	fromIndex map[string][]string
}

func newRegistryIndex(registry map[string]any) *registryIndex {
	ri := &registryIndex{
		version:   asInt(registry["version"]),
		toIndex:   map[string]map[string]int{},
		fromIndex: map[string][]string{},
	}
	kinds, _ := getMap(registry, "kinds")
	aliasesAny, _ := getMap(registry, "aliases")
	aliases := map[string]string{}
	for k, v := range aliasesAny {
		if s, ok := v.(string); ok {
			aliases[k] = s
		}
	}
	for _, kind := range shareKinds {
		ids := getStrList(kinds, kind)
		toIdx := map[string]int{}
		frm := make([]string, 0, len(ids))
		for i, id := range ids {
			toIdx[id] = i
			if alias, ok := aliases[id]; ok {
				frm = append(frm, alias)
			} else {
				frm = append(frm, id)
			}
		}
		for oldID, newID := range aliases {
			if slot, ok := toIdx[oldID]; ok {
				if _, exists := toIdx[newID]; !exists {
					toIdx[newID] = slot
				}
			}
		}
		ri.toIndex[kind] = toIdx
		ri.fromIndex[kind] = frm
	}
	return ri
}

func (ri *registryIndex) index(kind, id string) (int, bool) {
	i, ok := ri.toIndex[kind][id]
	return i, ok
}

func (ri *registryIndex) id(kind string, index int) (string, bool) {
	ids := ri.fromIndex[kind]
	if index < 0 || index >= len(ids) {
		return "", false
	}
	return ids[index], true
}

var (
	shareIndexOnce sync.Once
	shareIndexVal  *registryIndex
)

func embeddedShareIndex() *registryIndex {
	shareIndexOnce.Do(func() {
		var reg map[string]any
		if err := json.Unmarshal(shareRegistryJSON, &reg); err != nil {
			panic("wh40kdc: cannot parse embedded share_registry.json: " + err.Error())
		}
		shareIndexVal = newRegistryIndex(reg)
	})
	return shareIndexVal
}

// --- varint + base64url ---

func writeVarint(out *[]byte, value int) error {
	if value < 0 {
		return errShareEncode
	}
	v := uint64(value)
	for v >= 0x80 {
		*out = append(*out, byte((v&0x7f)|0x80))
		v >>= 7
	}
	*out = append(*out, byte(v))
	return nil
}

func writeStr(out *[]byte, s string) {
	b := []byte(s)
	_ = writeVarint(out, len(b))
	*out = append(*out, b...)
}

type reader struct {
	data []byte
	pos  int
}

func (r *reader) byte() (byte, error) {
	if r.pos >= len(r.data) {
		return 0, errMalformed
	}
	b := r.data[r.pos]
	r.pos++
	return b, nil
}

func (r *reader) varint() (int, error) {
	result := 0
	shift := 0
	for {
		b, err := r.byte()
		if err != nil {
			return 0, err
		}
		if shift >= 64 {
			return 0, errMalformed
		}
		result |= int(b&0x7f) << shift
		if b&0x80 == 0 {
			return result, nil
		}
		shift += 7
	}
}

func (r *reader) string() (string, error) {
	length, err := r.varint()
	if err != nil {
		return "", err
	}
	end := r.pos + length
	if end > len(r.data) || length < 0 {
		return "", errMalformed
	}
	chunk := r.data[r.pos:end]
	r.pos = end
	return string(chunk), nil
}

// --- encode ---

func requireIndex(ri *registryIndex, kind, id string) (int, error) {
	i, ok := ri.index(kind, id)
	if !ok {
		return 0, errShareEncode
	}
	return i, nil
}

func encodeShareList(list map[string]any, ri *registryIndex) (string, error) {
	var out []byte
	out = append(out, shareFormatVersion)
	if err := writeVarint(&out, ri.version); err != nil {
		return "", err
	}
	writeStr(&out, strOr(list, "name", ""))

	if list["factionId"] == nil {
		_ = writeVarint(&out, 0)
	} else {
		i, err := requireIndex(ri, "faction", getStr(list, "factionId"))
		if err != nil {
			return "", err
		}
		_ = writeVarint(&out, i+1)
	}
	battle := strOr(list, "battleSize", "strike-force")
	bi := 0
	for idx, b := range battleSizes {
		if b == battle {
			bi = idx
		}
	}
	_ = writeVarint(&out, bi)
	if list["disposition"] == nil {
		_ = writeVarint(&out, 0)
	} else {
		i, err := requireIndex(ri, "disposition", getStr(list, "disposition"))
		if err != nil {
			return "", err
		}
		_ = writeVarint(&out, i+1)
	}

	detachments := getStrList(list, "detachmentIds")
	_ = writeVarint(&out, len(detachments))
	for _, det := range detachments {
		i, err := requireIndex(ri, "detachment", det)
		if err != nil {
			return "", err
		}
		_ = writeVarint(&out, i)
	}

	units := getList(list, "units")
	_ = writeVarint(&out, len(units))
	for _, uAny := range units {
		u, _ := asMap(uAny)
		i, err := requireIndex(ri, "unit", getStr(u, "datasheetId"))
		if err != nil {
			return "", err
		}
		_ = writeVarint(&out, i)
		_ = writeVarint(&out, asInt(u["modelCount"]))
		enhancementID := getStr(u, "enhancementId")
		attached := u["attachedToOrdinal"]
		allyFaction := getStr(u, "allyFactionId")
		allyRule := getStr(u, "allyRuleId")
		grants := getStrList(u, "grants")
		loadout := getList(u, "loadout")
		flags := 0
		if truthy(u["isWarlord"]) {
			flags |= flagWarlord
		}
		if enhancementID != "" {
			flags |= flagEnh
		}
		if attached != nil {
			flags |= flagAttach
		}
		if allyRule != "" || allyFaction != "" {
			flags |= flagAlly
		}
		if len(grants) > 0 {
			flags |= flagGrants
		}
		_ = writeVarint(&out, flags)
		if enhancementID != "" {
			i, err := requireIndex(ri, "enhancement", enhancementID)
			if err != nil {
				return "", err
			}
			_ = writeVarint(&out, i)
		}
		if attached != nil {
			_ = writeVarint(&out, asInt(attached))
		}
		if flags&flagAlly != 0 {
			if allyFaction == "" {
				_ = writeVarint(&out, 0)
			} else {
				i, err := requireIndex(ri, "faction", allyFaction)
				if err != nil {
					return "", err
				}
				_ = writeVarint(&out, i+1)
			}
			if allyRule == "" {
				_ = writeVarint(&out, 0)
			} else {
				i, err := requireIndex(ri, "ally_rule", allyRule)
				if err != nil {
					return "", err
				}
				_ = writeVarint(&out, i+1)
			}
		}
		if len(grants) > 0 {
			_ = writeVarint(&out, len(grants))
			for _, g := range grants {
				writeStr(&out, g)
			}
		}
		_ = writeVarint(&out, len(loadout))
		for _, pairAny := range loadout {
			pair, _ := asList(pairAny)
			if len(pair) != 2 {
				return "", errShareEncode
			}
			wid, _ := pair[0].(string)
			i, err := requireIndex(ri, "wargear", wid)
			if err != nil {
				return "", err
			}
			_ = writeVarint(&out, i)
			_ = writeVarint(&out, asInt(pair[1]))
		}
	}
	return base64.RawURLEncoding.EncodeToString(out), nil
}

func encodeShareToken(list map[string]any) (string, error) {
	return encodeShareList(list, embeddedShareIndex())
}

// --- decode ---

func requireID(ri *registryIndex, kind string, slot int) (string, error) {
	id, ok := ri.id(kind, slot)
	if !ok {
		return "", errStaleRegistry
	}
	return id, nil
}

func b64urlDecode(token string) ([]byte, error) {
	pad := strings.Repeat("=", (4-len(token)%4)%4)
	return base64.URLEncoding.DecodeString(token + pad)
}

func decodeInner(token string, ri *registryIndex) (map[string]any, error) {
	data, err := b64urlDecode(token)
	if err != nil {
		return nil, errMalformed
	}
	r := &reader{data: data}
	b, err := r.byte()
	if err != nil || b != shareFormatVersion {
		return nil, errMalformed
	}
	if _, err := r.varint(); err != nil { // registry version — informational
		return nil, err
	}
	name, err := r.string()
	if err != nil {
		return nil, err
	}
	factionRef, err := r.varint()
	if err != nil {
		return nil, err
	}
	var factionID any
	if factionRef != 0 {
		id, err := requireID(ri, "faction", factionRef-1)
		if err != nil {
			return nil, err
		}
		factionID = id
	}
	battleIdx, err := r.varint()
	if err != nil {
		return nil, err
	}
	battleSize := "strike-force"
	if battleIdx >= 0 && battleIdx < len(battleSizes) {
		battleSize = battleSizes[battleIdx]
	}
	dispositionRef, err := r.varint()
	if err != nil {
		return nil, err
	}
	var disposition any
	if dispositionRef != 0 {
		id, err := requireID(ri, "disposition", dispositionRef-1)
		if err != nil {
			return nil, err
		}
		disposition = id
	}
	detCount, err := r.varint()
	if err != nil {
		return nil, err
	}
	detachmentIDs := []any{}
	for i := 0; i < detCount; i++ {
		slot, err := r.varint()
		if err != nil {
			return nil, err
		}
		id, err := requireID(ri, "detachment", slot)
		if err != nil {
			return nil, err
		}
		detachmentIDs = append(detachmentIDs, id)
	}
	unitCount, err := r.varint()
	if err != nil {
		return nil, err
	}
	units := []any{}
	for i := 0; i < unitCount; i++ {
		slot, err := r.varint()
		if err != nil {
			return nil, err
		}
		datasheetID, err := requireID(ri, "unit", slot)
		if err != nil {
			return nil, err
		}
		modelCount, err := r.varint()
		if err != nil {
			return nil, err
		}
		flags, err := r.varint()
		if err != nil {
			return nil, err
		}
		var enhancementID any
		if flags&flagEnh != 0 {
			s, err := r.varint()
			if err != nil {
				return nil, err
			}
			id, err := requireID(ri, "enhancement", s)
			if err != nil {
				return nil, err
			}
			enhancementID = id
		}
		var attached any
		if flags&flagAttach != 0 {
			v, err := r.varint()
			if err != nil {
				return nil, err
			}
			attached = float64(v)
		}
		var allyFactionID, allyRuleID any
		if flags&flagAlly != 0 {
			fRef, err := r.varint()
			if err != nil {
				return nil, err
			}
			if fRef != 0 {
				id, err := requireID(ri, "faction", fRef-1)
				if err != nil {
					return nil, err
				}
				allyFactionID = id
			}
			ruleRef, err := r.varint()
			if err != nil {
				return nil, err
			}
			if ruleRef != 0 {
				id, err := requireID(ri, "ally_rule", ruleRef-1)
				if err != nil {
					return nil, err
				}
				allyRuleID = id
			}
		}
		grants := []any{}
		if flags&flagGrants != 0 {
			n, err := r.varint()
			if err != nil {
				return nil, err
			}
			for j := 0; j < n; j++ {
				g, err := r.string()
				if err != nil {
					return nil, err
				}
				grants = append(grants, g)
			}
		}
		loadout := []any{}
		nL, err := r.varint()
		if err != nil {
			return nil, err
		}
		for j := 0; j < nL; j++ {
			s, err := r.varint()
			if err != nil {
				return nil, err
			}
			wid, err := requireID(ri, "wargear", s)
			if err != nil {
				return nil, err
			}
			count, err := r.varint()
			if err != nil {
				return nil, err
			}
			loadout = append(loadout, []any{wid, float64(count)})
		}
		units = append(units, map[string]any{
			"datasheetId":       datasheetID,
			"modelCount":        float64(modelCount),
			"isWarlord":         flags&flagWarlord != 0,
			"enhancementId":     enhancementID,
			"allyFactionId":     allyFactionID,
			"allyRuleId":        allyRuleID,
			"attachedToOrdinal": attached,
			"grants":            grants,
			"loadout":           loadout,
		})
	}
	return map[string]any{
		"name":          name,
		"factionId":     factionID,
		"detachmentIds": detachmentIDs,
		"battleSize":    battleSize,
		"disposition":   disposition,
		"units":         units,
	}, nil
}

func decodeShareList(token string, ri *registryIndex) map[string]any {
	list, err := decodeInner(token, ri)
	if err != nil {
		if errors.Is(err, errStaleRegistry) {
			return map[string]any{"ok": false, "reason": "stale-registry"}
		}
		return map[string]any{"ok": false, "reason": "malformed"}
	}
	return map[string]any{"ok": true, "list": list}
}

func decodeShareToken(token string) map[string]any {
	return decodeShareList(token, embeddedShareIndex())
}
