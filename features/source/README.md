# Local Feature Source Folder

When Confluence attachment downloads are blocked (scoped API tokens cannot
use the `/download/attachments/` endpoint), `scripts/fetchFeatures.js` falls
back to copies kept in **this folder**.

## Workflow

1. Keep a canonical copy of every `.feature` file here (commit them to git).
2. Confluence's **Feature Selection** table still controls which features run
   (`Run = Yes`), reports get uploaded, and status is tracked — exactly as before.
3. Each time `fetchFeatures.js` runs, it tries these sources in order:
   1. The Confluence attachment (preferred — only works with classic API tokens)
   2. A `<ac:structured-macro ac:name="code">` block on the Feature File page
      whose **Title** matches the filename
   3. A file in this folder with the matching name

## Naming

Filenames must match (case-insensitive) the title of the corresponding row in
the Confluence Feature Selection table. Either form works:

```
Janki.feature
contact_us.feature
FindADealer-FIFO.feature
```

## Updating a feature

Edit the local file → commit → re-run `npm run agent:run`. There's no need to
re-upload anything to Confluence for tests to pick up the change — the
attachment is only the historical/visual record.
