package runs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

var unmarshalerType = reflect.TypeFor[json.Unmarshaler]()

// project is raw held to the contract's type t (an apitypes Run schema,
// generated from openapi.yaml): every object keeps only the members t
// names, at every depth, each leaf as written. So the wire is exactly the
// contract, and a member the nightly adds under a row, a format or a
// player reaches no one until the contract names it.
func project(raw json.RawMessage, t reflect.Type) (json.RawMessage, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return raw, nil
	}
	switch {
	case leaf(t):
		return raw, nil
	case t.Kind() == reflect.Pointer:
		return project(raw, t.Elem())
	case t.Kind() == reflect.Slice:
		return projectList(raw, t.Elem())
	case t.Kind() == reflect.Map:
		return projectMap(raw, t.Elem())
	default:
		return projectObject(raw, t)
	}
}

// leaf is a value kept as written: a scalar, an enum, or a type that
// reads itself (a time, a date).
func leaf(t reflect.Type) bool {
	switch t.Kind() {
	case reflect.Pointer, reflect.Slice, reflect.Map:
		return false
	case reflect.Struct:
		return reflect.PointerTo(t).Implements(unmarshalerType)
	default:
		return true
	}
}

func projectList(raw json.RawMessage, elem reflect.Type) (json.RawMessage, error) {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, len(items))
	for i, item := range items {
		projected, err := project(item, elem)
		if err != nil {
			return nil, fmt.Errorf("[%d]: %w", i, err)
		}
		out[i] = projected
	}
	return json.Marshal(out)
}

func projectMap(raw json.RawMessage, elem reflect.Type) (json.RawMessage, error) {
	var members map[string]json.RawMessage
	if err := json.Unmarshal(raw, &members); err != nil {
		return nil, err
	}
	out := make(map[string]json.RawMessage, len(members))
	for key, value := range members {
		projected, err := project(value, elem)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", key, err)
		}
		out[key] = projected
	}
	return json.Marshal(out)
}

func projectObject(raw json.RawMessage, t reflect.Type) (json.RawMessage, error) {
	var members map[string]json.RawMessage
	if err := json.Unmarshal(raw, &members); err != nil {
		return nil, err
	}
	out := make(map[string]json.RawMessage, t.NumField())
	for i := range t.NumField() {
		f := t.Field(i)
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "" || name == "-" {
			continue
		}
		value, ok := members[name]
		if !ok {
			continue
		}
		projected, err := project(value, f.Type)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		out[name] = projected
	}
	return json.Marshal(out)
}
