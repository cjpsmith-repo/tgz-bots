# TGZ Solo

A rules-enforced, single-player version of *The Great Zimbabwe* (Splotter Spellen) played against 1–4 bots in the browser. This is a private fan implementation written from scratch from the rulebook; it uses plain shapes and emoji instead of the game's art.

## Running

```sh
npm install
npm run dev            # play at http://localhost:5173
npm test               # rules tests
npm run sim -- 5 4     # 5 bot-only games with 4 players
npm run build:artifact # single self-contained HTML file in dist-artifact/
```

The game autosaves in the browser. **Undo** steps back to before your last action (bot moves after it are replayed).

## Layout

- `data/game-data.json`: map tiles A–K, technology cards, gods, specialists, map layouts. Card values were read from card images; tiles from the boardgamehelpers.com tile key.
- `src/engine/`: the rules engine, pure TypeScript with no DOM.
  - `game.ts`: setup, bidding, turns, actions, revenue and victory. `applyAction(state, action)` returns a new state or throws `IllegalAction`.
  - `board.ts`: map building, water areas, transport range and hub distances.
  - `raise.ts`: finds the cheapest way to source ritual goods for a set of monuments.
  - `bot.ts`: heuristic bot; tries candidate turns on a copy of the game and scores the results.
- `src/main.ts`: the browser UI.
- `tests/rules.test.ts`: includes the rulebook's bidding and raising examples.

## Rule interpretations

Where the rulebook is ambiguous, the engine does this:

- **Range** is counted in 8 directions; a continuous (orthogonally connected) water area counts as one step.
- **Passing a monument** forces using it as a hub. This applies to paths to craftsmen (raising, and secondary craftsmen reaching primaries); ranges from a craftsman to its resources are not blocked by monuments.
- **Shadipinyi's plaque** joins the bidding only once someone adores Shadipinyi.
- **Dziva** can lower and raise prices once during any turn of her worshipper (onlineboardgamers' Splotter-approved variant is similar).
- **First primary + secondary**: a secondary craftsman cannot be built in the same turn in which that player placed the first craftsman on the map of the primary type it needs.
- **Raising** uses the cheapest sourcing the solver finds; you choose which monuments to raise, not which craftsmen to buy from.
- A safety stop ends the game after 40 rounds (best VP − VR margin wins); bot games normally end in about 10.

## Not yet done

- The Schism fan expansion (extra gods, Blacksmith).
- Choosing individual craftsmen when raising.
- Stronger bots (search-based).
