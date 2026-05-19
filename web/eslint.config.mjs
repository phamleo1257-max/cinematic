export default [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "app/**"],
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        require: "readonly",
        URLSearchParams: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "error",
      "no-undef": "error",
    },
  },
];
