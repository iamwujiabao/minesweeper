# Minesweeper with undo

A Minesweeper game for the browser, written in plain HTML, CSS and JavaScript: no framework, no build step, no packages. It has a full undo and redo, hints, several game modes, hexagonal and wrap-around boards, a daily challenge, replay, themes and keyboard and touch play.

The design, rules, patterns, class diagrams, test results and demo script are in REPORT.md.

## Run it

Open index.html in a modern browser (double-click it). Nothing to install or build; it also works offline and straight from disk. If your browser blocks something on file pages, serve the folder instead:

    npm run serve

and open http://127.0.0.1:4173/ (or run python3 -m http.server in the folder).

## Controls

- Click opens a cell; clicking an open number whose flags are all placed opens its neighbours.
- Right-click (long-press on a phone, or Flag mode) flags, then marks with ?, then clears.
- Arrow keys move, Enter or Space opens, F flags, H hints, U undoes, Y redoes, N starts a new game. The ? button lists every shortcut, and Settings, Controls changes them.

## Project layout

    index.html          the page
    style.css           layout, themes, animation
    src/                the game (see REPORT.md section 3 for each file)
    test/               logic tests (Node)
    e2e/                browser tests (Playwright, optional)
    scripts/            serve.js (tiny static server), screenshots.js
    docs/screenshots/   the pictures used in REPORT.md
    .github/workflows/  GitHub Actions: tests and GitHub Pages

## Tests

Logic tests need only Node 18 or newer and no install:

    node --test

Browser tests are optional and use Playwright, the project's only dependency:

    npm install
    npx playwright install        (once; downloads the browsers)
    npm run test:e2e              (all browsers and the two phone profiles)
    npm run test:e2e -- --project=webkit
    PW_CHANNEL=chrome npm run test:e2e    (use your own Chrome for the Chromium projects)

To make the report screenshots again: node scripts/screenshots.js

## Publish on GitHub Pages

The page is a set of static files, so GitHub Pages can host it as it is. The workflow in .github/workflows/pages.yml runs the logic tests and then publishes index.html, style.css and src/ on every push to main.

1. Create a repository on GitHub and push this project to its main branch.
2. In the repository, open Settings, then Pages, and set Source to GitHub Actions.
3. Push again (or run the workflow from the Actions tab). The address appears in the workflow summary; it looks like https://YOUR-NAME.github.io/YOUR-REPOSITORY/.

All the page's links are relative, so it works under that sub-path. The second workflow, e2e.yml, runs the browser tests; it only runs when started by hand from the Actions tab.
