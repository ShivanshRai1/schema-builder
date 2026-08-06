/** Monaco Monarch grammar for SPICE / netlist highlighting. */
export const spiceLanguageId = "spice";

export const spiceTokensProvider = {
  ignoreCase: true,
  defaultToken: "",
  tokenizer: {
    root: [
      [/^\*.*$/, "comment"],
      [/;.*$/, "comment"],
      [
        /^\.(subckt|ends|model|tran|ac|dc|op|save|probe|options|param|include|lib|end)\b/,
        "keyword",
      ],
      [/^\.[a-zA-Z_][\w]*/, "keyword"],
      [/^(R|L|C|V|I|D|M|Q|X|K|B|E|F|G|H|S|W|T|U)[\w.]*/, "type"],
      [/\b(DC|AC|PULSE|SIN|EXP|PWL|SFFM|ic)\b/, "constant"],
      [/[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?[a-zA-Z]*/, "number"],
      [/"[^"]*"/, "string"],
      [/'[^']*'/, "string"],
      [/[a-zA-Z_][\w.]*/, "identifier"],
    ],
  },
};
