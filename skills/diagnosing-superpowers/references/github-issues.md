# GitHub issues

Issues go to the plugin's own repository, `DollarDill/beads-superpowers`.
Never search or file on the upstream `obra/superpowers` repository: the
fork's maintainers decide whether a report belongs upstream.

Use `gh` when it is installed and authenticated; it handles auth, rate
limits, and JSON. Fall back to the public API with curl, then to a URL
your partner opens.

## Search

```bash
gh search issues --repo DollarDill/beads-superpowers --limit 10 "<terms>" \
  --json number,state,title --jq '.[] | "\(.number)\t\(.state)\t\(.title)"'
```

Without `gh` (unauthenticated, 10 requests a minute):

```bash
curl -s -H "Accept: application/vnd.github+json" \
  "https://api.github.com/search/issues?q=repo:DollarDill/beads-superpowers+is:issue+<url-encoded terms>&per_page=10" \
  | jq -r '.items[] | "\(.number)\t\(.state)\t\(.title)"'
```

Without curl, hand over `https://github.com/DollarDill/beads-superpowers/issues?q=<terms>`.

## File

Write the filled `templates/issue.md` to the workspace and show the exact
text. After approval:

```bash
gh issue create --repo DollarDill/beads-superpowers --title "<title>" \
  --body-file <path> --label bug
```

`gh` refuses a label the repository does not have, so pass only `bug`;
the template footer marks the issue as skill-filed. `gh` cannot attach
files: give your partner the bundle path to attach through the browser
after the issue exists.

Without `gh`, hand over a prefilled link on the `diagnosis_report.md`
template:

```
https://github.com/DollarDill/beads-superpowers/issues/new?template=diagnosis_report.md&title=<url-encoded title>&body=<url-encoded body>
```

GitHub rejects URLs over about 8,000 characters; past that, send the link
with the title only and tell your partner to paste the body from the file.
