package runs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
)

// The run's names, the web's (web/src/lib/run/schema.ts and primitives.ts).
var (
	runIDPattern  = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}(-[a-z0-9-]+)?$`)
	formatPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*-[0-9]{1,2}$`)
)

const (
	runsPrefix    = "runs"
	latestPointer = "latest.json"
	manifestPath  = "manifest.json"
	// marketBasis is a kicker's or a defense's orderBasis: in the
	// drafters' order after the ranked rows (the web's run/market.ts).
	marketBasis = "market"
)

// The members of the manifest and of the capture the apps are sent: the
// web's manifestSchema and designationsSchema, less the provenance no
// screen prints (no public data credits: the manifest's sources and the
// capture's feed). What else the nightly writes in its manifest (its
// status, its register's steps, its code's versions) is ours alone.
var (
	manifestMembers     = []string{"runId", "runAt", "season", "implementation", "standIn", "formats", "players"}
	designationsMembers = []string{"readAt", "checkedAt", "players"}
)

// field is one member of an answer beside its run id, the run's JSON.
type field struct {
	name  string
	value json.RawMessage
}

// artifact is one file of a run and how its answer is shaped from it.
type artifact struct {
	path string
	// hourly files are written beside the run again every publish hour
	// (designations.json), so they are read again with each pointer
	// check and their ETag carries what they hold.
	hourly bool
	// optional files a run may leave out answer null.
	optional bool
	// name is the answer's member an optional file's null is sent as.
	name  string
	shape func(raw []byte) ([]field, error)
}

var (
	manifestFile = artifact{path: manifestPath, name: "manifest", shape: func(raw []byte) ([]field, error) {
		return picked("manifest", raw, manifestMembers)
	}}
	indexFile = artifact{path: "index.json", name: "index", shape: shapeIndex}
	adpFile   = artifact{path: "adp.json", name: "adp", shape: func(raw []byte) ([]field, error) {
		if !json.Valid(raw) {
			return nil, fmt.Errorf("adp.json is not JSON")
		}
		return []field{{"adp", raw}}, nil
	}}
	designationsFile = artifact{path: "designations.json", name: "designations", hourly: true, optional: true,
		shape: func(raw []byte) ([]field, error) { return picked("designations", raw, designationsMembers) }}
)

// boardFile is a format's board, its ranked rows and its kickers and
// defenses apart, each in the file's order.
func boardFile(format string) artifact {
	return artifact{path: "boards/" + format + ".json", name: "board", shape: func(raw []byte) ([]field, error) {
		var file struct {
			Format string            `json:"format"`
			Rows   []json.RawMessage `json:"rows"`
		}
		if err := json.Unmarshal(raw, &file); err != nil {
			return nil, fmt.Errorf("boards/%s.json: %w", format, err)
		}
		if file.Format != format {
			return nil, fmt.Errorf("boards/%s.json says it is the %q board", format, file.Format)
		}
		rows, market, err := splitMarket(file.Rows)
		if err != nil {
			return nil, fmt.Errorf("boards/%s.json: %w", format, err)
		}
		name, _ := json.Marshal(file.Format)
		return []field{{"format", name}, {"rows", rows}, {"market", market}}, nil
	}}
}

func shapeIndex(raw []byte) ([]field, error) {
	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("index.json: %w", err)
	}
	pages, market, err := splitMarket(entries)
	if err != nil {
		return nil, fmt.Errorf("index.json: %w", err)
	}
	return []field{{"pages", pages}, {"market", market}}, nil
}

// splitMarket is a list's projection-ranked members and its kickers and
// defenses apart, each in the list's order, each member as written.
func splitMarket(members []json.RawMessage) (ranked, market json.RawMessage, err error) {
	byBasis := map[bool][]json.RawMessage{false: {}, true: {}}
	for i, member := range members {
		var basis struct {
			OrderBasis string `json:"orderBasis"`
		}
		if err := json.Unmarshal(member, &basis); err != nil {
			return nil, nil, fmt.Errorf("member %d: %w", i, err)
		}
		isMarket := basis.OrderBasis == marketBasis
		byBasis[isMarket] = append(byBasis[isMarket], member)
	}
	if ranked, err = json.Marshal(byBasis[false]); err != nil {
		return nil, nil, err
	}
	market, err = json.Marshal(byBasis[true])
	return ranked, market, err
}

// picked is an answer of one member: the file's object with only the
// members named, each as written. A member it lacks is left out, as the
// file leaves it out.
func picked(name string, raw []byte, members []string) ([]field, error) {
	var all map[string]json.RawMessage
	if err := json.Unmarshal(raw, &all); err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	kept := make(map[string]json.RawMessage, len(members))
	for _, member := range members {
		if value, ok := all[member]; ok {
			kept[member] = value
		}
	}
	value, err := json.Marshal(kept)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return []field{{name, value}}, nil
}

// encodeAnswer is the answer's data: the run id, then each field.
func encodeAnswer(runID string, fields []field) (json.RawMessage, error) {
	var b bytes.Buffer
	id, err := json.Marshal(runID)
	if err != nil {
		return nil, err
	}
	b.WriteString(`{"run_id":`)
	b.Write(id)
	for _, f := range fields {
		name, err := json.Marshal(f.name)
		if err != nil {
			return nil, err
		}
		b.WriteByte(',')
		b.Write(name)
		b.WriteByte(':')
		b.Write(f.value)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}
