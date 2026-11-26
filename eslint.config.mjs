import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Decision 10 / AT-030: valor de nota nunca passa por ponto flutuante.
const semPontoFlutuante = {
  files: ["src/lib/nfse/**/*.ts", "src/lib/importacao/**/*.ts", "src/lib/money.ts"],
  rules: {
    "no-restricted-globals": ["error", { name: "parseFloat", message: "Use src/lib/money.ts (decimal.js)." }],
    "no-restricted-syntax": [
      "error",
      { selector: "CallExpression[callee.name='Number']", message: "Use src/lib/money.ts (decimal.js)." },
      { selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']", message: "Use src/lib/money.ts (decimal.js)." },
      { selector: "CallExpression[callee.property.name='toFixed']:not([callee.object.type='CallExpression'])", message: "toFixed só sobre Decimal." },
    ],
  },
};

export default [...nextVitals, ...nextTs, { ignores: [".next/**", "node_modules/**"] }, semPontoFlutuante];
