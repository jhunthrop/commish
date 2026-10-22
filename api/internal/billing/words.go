package billing

// freeSeasonWords is checkout's refusal in a free season, the sentence a
// member reads on the pass page (the web shows the API's own message).
// "pay for", never "buy": buy is a trading word the site never prints
// (web/src/lib/format/banned-words.json).
const freeSeasonWords = "This season is free. There is nothing to pay for yet."
