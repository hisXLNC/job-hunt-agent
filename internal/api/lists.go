package api

import (
	"encoding"
	"encoding/json"
	"reflect"
)

var (
	jsonMarshaler = reflect.TypeFor[json.Marshaler]()
	textMarshaler = reflect.TypeFor[encoding.TextMarshaler]()
)

// lists returns a copy of v in which every empty list or map is written as
// [] or {} rather than null, so a page can always count and loop over what it
// was sent. The original is left alone.
func lists(v any) any {
	if v == nil {
		return nil
	}
	return fill(reflect.ValueOf(v)).Interface()
}

func fill(v reflect.Value) reflect.Value {
	t := v.Type()
	if t.Implements(jsonMarshaler) || reflect.PointerTo(t).Implements(jsonMarshaler) || t.Implements(textMarshaler) || reflect.PointerTo(t).Implements(textMarshaler) {
		return v
	}
	switch v.Kind() {
	case reflect.Slice:
		if t.Elem().Kind() == reflect.Uint8 {
			return v
		}
		out := reflect.MakeSlice(t, v.Len(), v.Len())
		for i := range v.Len() {
			out.Index(i).Set(fill(v.Index(i)))
		}
		return out
	case reflect.Map:
		out := reflect.MakeMapWithSize(t, v.Len())
		for it := v.MapRange(); it.Next(); {
			out.SetMapIndex(it.Key(), fill(it.Value()))
		}
		return out
	case reflect.Pointer:
		if v.IsNil() {
			return v
		}
		out := reflect.New(t.Elem())
		out.Elem().Set(fill(v.Elem()))
		return out
	case reflect.Interface:
		if v.IsNil() {
			return v
		}
		out := reflect.New(t).Elem()
		out.Set(fill(v.Elem()))
		return out
	case reflect.Struct:
		out := reflect.New(t).Elem()
		out.Set(v)
		for i := range t.NumField() {
			if t.Field(i).IsExported() {
				out.Field(i).Set(fill(v.Field(i)))
			}
		}
		return out
	}
	return v
}
