package ffpc

import (
	"bytes"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
)

// A small DOM reader over golang.org/x/net/html: the parsers find
// elements by tag, id and class and read their text. Nothing here runs a
// page's script or follows a link.

// MaxPage bounds one page's HTML: FFPC's richest league page is under
// 300 KB, so 3 MB is room without letting a body grow without end.
const MaxPage = 3 << 20

type node = html.Node

func parse(page []byte) (*node, error) {
	if len(page) > MaxPage {
		return nil, fmt.Errorf("ffpc: page of %d bytes", len(page))
	}
	doc, err := html.Parse(bytes.NewReader(page))
	if err != nil {
		return nil, fmt.Errorf("ffpc: parse: %w", err)
	}
	return doc, nil
}

func attr(n *node, key string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			return a.Val
		}
	}
	return ""
}

func isTag(n *node, tag string) bool { return n.Type == html.ElementNode && n.Data == tag }

func hasClass(n *node, class string) bool {
	for _, c := range strings.Fields(attr(n, "class")) {
		if c == class {
			return true
		}
	}
	return false
}

// all is every element under n (n included) that keep accepts, in
// document order.
func all(n *node, keep func(*node) bool) []*node {
	var out []*node
	var walk func(*node)
	walk = func(c *node) {
		if c.Type == html.ElementNode && keep(c) {
			out = append(out, c)
		}
		for k := c.FirstChild; k != nil; k = k.NextSibling {
			walk(k)
		}
	}
	walk(n)
	return out
}

func first(n *node, keep func(*node) bool) *node {
	if found := all(n, keep); len(found) > 0 {
		return found[0]
	}
	return nil
}

func tag(name string) func(*node) bool { return func(n *node) bool { return isTag(n, name) } }

func tagClass(name, class string) func(*node) bool {
	return func(n *node) bool { return isTag(n, name) && hasClass(n, class) }
}

func idSuffix(suffix string) func(*node) bool {
	return func(n *node) bool { return strings.HasSuffix(attr(n, "id"), suffix) }
}

func idContains(part string) func(*node) bool {
	return func(n *node) bool { return strings.Contains(attr(n, "id"), part) }
}

// children is n's element children with the tag.
func children(n *node, name string) []*node {
	var out []*node
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if isTag(c, name) {
			out = append(out, c)
		}
	}
	return out
}

// rows is a table's rows, through a tbody when it has one, never a
// nested table's.
func rows(table *node) []*node {
	var out []*node
	for c := table.FirstChild; c != nil; c = c.NextSibling {
		switch {
		case isTag(c, "tr"):
			out = append(out, c)
		case isTag(c, "tbody") || isTag(c, "thead"):
			out = append(out, children(c, "tr")...)
		}
	}
	return out
}

// cells is a row's td and th cells.
func cells(tr *node) []*node {
	var out []*node
	for c := tr.FirstChild; c != nil; c = c.NextSibling {
		if isTag(c, "td") || isTag(c, "th") {
			out = append(out, c)
		}
	}
	return out
}

// text is the node's text with whitespace collapsed; comments and the
// text of script and style elements are left out.
func text(n *node) string {
	var b strings.Builder
	var walk func(*node)
	walk = func(c *node) {
		switch {
		case c.Type == html.TextNode:
			b.WriteString(c.Data)
			b.WriteByte(' ')
		case c.Type == html.ElementNode && (c.Data == "script" || c.Data == "style"):
			return
		case c.Type == html.ElementNode && c.Data == "br":
			b.WriteByte('\n')
		}
		for k := c.FirstChild; k != nil; k = k.NextSibling {
			walk(k)
		}
	}
	walk(n)
	return collapse(b.String())
}

// ownText is the text directly inside n, not inside its child elements.
func ownText(n *node) string {
	var b strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			b.WriteString(c.Data)
			b.WriteByte(' ')
		}
	}
	return collapse(b.String())
}

func collapse(s string) string {
	return strings.Join(strings.FieldsFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == ' ' }), " ")
}

// maxText bounds a name or a rule's words as a page gives them.
const maxText = 160

// Clean is a host's words as we keep them: control and format
// characters dropped, whitespace collapsed, valid UTF-8, cut at a rune.
func Clean(s string, limit int) string {
	s = strings.Map(func(r rune) rune {
		switch {
		case unicode.IsSpace(r):
			return ' '
		case unicode.IsControl(r) || unicode.Is(unicode.Cf, r):
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, ""))
	s = collapse(s)
	if utf8.RuneCountInString(s) > limit {
		s = string([]rune(s)[:limit])
	}
	return s
}
