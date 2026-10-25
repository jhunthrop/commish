package runs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"

	"github.com/jhunthrop/commish/api/internal/apitypes"
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

// Each file is held to its contract type (project.go), so the apps get
// exactly what openapi.yaml names, which the web's test holds to its zod
// schemas: never the provenance no screen prints (the manifest's sources,
// the capture's feed; no public data credits) nor what else the nightly
// writes for itself (its status, its register's steps, its versions).
var (
	manifestFile     = artifact{path: manifestPath, name: "manifest", shape: whole("manifest", reflect.TypeFor[apitypes.RunManifest]())}
	indexFile        = artifact{path: "index.json", name: "index", shape: shapeIndex}
	adpFile          = artifact{path: "adp.json", name: "adp", shape: whole("adp", reflect.TypeFor[apitypes.RunAdp]())}
	designationsFile = artifact{path: "designations.json", name: "designations", hourly: true, optional: true,
		shape: whole("designations", reflect.TypeFor[apitypes.RunDesignations]())}
)

// The rows and entries of the two kinds a board and the index carry.
var (
	boardRowType    = reflect.TypeFor[apitypes.RunBoardRow]()
	marketRowType   = reflect.TypeFor[apitypes.RunMarketRow]()
	indexEntryType  = reflect.TypeFor[apitypes.RunIndexEntry]()
	marketEntryType = reflect.TypeFor[apitypes.RunMarketEntry]()
)

// whole is an answer of one member, the file held to its contract type.
func whole(name string, t reflect.Type) func(raw []byte) ([]field, error) {
	return func(raw []byte) ([]field, error) {
		value, err := project(raw, t)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		return []field{{name, value}}, nil
	}
}

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
		rows, market, err := splitMarket(file.Rows, boardRowType, marketRowType)
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
	pages, market, err := splitMarket(entries, indexEntryType, marketEntryType)
	if err != nil {
		return nil, fmt.Errorf("index.json: %w", err)
	}
	return []field{{"pages", pages}, {"market", market}}, nil
}

// splitMarket is a list's projection-ranked members and its kickers and
// defenses apart, each in the list's order, each held to its type.
func splitMarket(members []json.RawMessage, rankedType, marketType reflect.Type) (ranked, market json.RawMessage, err error) {
	byBasis := map[bool][]json.RawMessage{false: {}, true: {}}
	for i, member := range members {
		var basis struct {
			OrderBasis string `json:"orderBasis"`
		}
		if err := json.Unmarshal(member, &basis); err != nil {
			return nil, nil, fmt.Errorf("member %d: %w", i, err)
		}
		isMarket := basis.OrderBasis == marketBasis
		t := rankedType
		if isMarket {
			t = marketType
		}
		projected, err := project(member, t)
		if err != nil {
			return nil, nil, fmt.Errorf("member %d: %w", i, err)
		}
		byBasis[isMarket] = append(byBasis[isMarket], projected)
	}
	if ranked, err = json.Marshal(byBasis[false]); err != nil {
		return nil, nil, err
	}
	market, err = json.Marshal(byBasis[true])
	return ranked, market, err
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
