package wh40kdc

import (
	"regexp"
	"strconv"
	"strings"
)

// GW app "Attached Units" groups: `Attached Unit N` headings followed by units
// whose `Attached as: Leader|Support|Bodyguard` annotation names their role.
// Mirror of the group handling in tools/src/import/gw-headerless.ts.

var (
	attachedRoleRe      = regexp.MustCompile(`(?i)^(leader|support|bodyguard)\b`)
	attachedUnitRe      = regexp.MustCompile(`(?i)^attached unit\s+(\d+)$`)
	attachedSectionRe   = regexp.MustCompile(`(?i)^attached units?(?:\s+\d+)?$`)
	attachedAsSupportRe = regexp.MustCompile(`(?i)^attached as support\s*:?\s*$`)
)

// attachedAsRole returns the role ("leader", "support", "bodyguard") at the
// start of an `Attached as:` annotation's value, or "" when none.
func attachedAsRole(value string) string {
	if m := attachedRoleRe.FindStringSubmatch(strings.TrimSpace(value)); m != nil {
		return strings.ToLower(m[1])
	}
	return ""
}

// attachedUnitNumber returns the group number of an `Attached Unit N` heading.
func attachedUnitNumber(line string) (int, bool) {
	m := attachedUnitRe.FindStringSubmatch(line)
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

// attachedGroupMember is one unit inside an `Attached Unit N` group.
type attachedGroupMember struct {
	unitIndex int
	group     int
	role      string
}

// pairAttachedGroups points every Leader/Support member of a group at that
// group's first Bodyguard. Groups without a Bodyguard stay unattached.
func pairAttachedGroups(units []map[string]any, members []attachedGroupMember) {
	var groups []int
	seen := map[int]bool{}
	for _, m := range members {
		if !seen[m.group] {
			seen[m.group] = true
			groups = append(groups, m.group)
		}
	}
	for _, group := range groups {
		bodyguard := -1
		for _, m := range members {
			if m.group == group && m.role == "bodyguard" {
				bodyguard = m.unitIndex
				break
			}
		}
		if bodyguard < 0 {
			continue
		}
		for _, m := range members {
			if m.group != group || m.role == "bodyguard" {
				continue
			}
			units[m.unitIndex]["leader_attachment"] = map[string]any{
				"bodyguard_raw_name": units[bodyguard]["raw_name"],
				"role":               m.role,
				"provisional":        false,
			}
		}
	}
}
