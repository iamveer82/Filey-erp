// Read-only runtime import graph and page action inventory. Candidate modules
// still require checking non-runtime entry points before removal.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const files = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.[cm]?[jt]sx?$/.test(file) && !/\.d\.ts$/.test(file) && !/[\\/]__tests__[\\/]|\.(test|spec)\./.test(file)) files.push(file);
  }
}
scan(path.join(root, "src"));
const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile).config;
const options = ts.parseJsonConfigFileContent(config, ts.sys, root).options;
const graph = new Map();
const actions = [];
const routes = [];
const registeredRoutes = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const links = new Set();
  const add = (specifier) => {
    if (!specifier) return;
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (resolved && !resolved.includes("node_modules")) links.add(path.normalize(resolved));
  };
  function walk(node) {
    if (relative(file) === "src/modules/registry.tsx" && ts.isObjectLiteralExpression(node)) {
      const fields = new Map(node.properties.filter(ts.isPropertyAssignment).map(prop => [prop.name.getText(ast), prop.initializer]));
      if (fields.has("to") && fields.has("Component")) {
        registeredRoutes.push({
          id: fields.get("id")?.text,
          label: fields.get("label")?.text,
          path: fields.get("to")?.text,
          component: fields.get("Component")?.getText(ast),
          file: relative(file),
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        });
      }
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
    if (ts.isNewExpression(node) && node.expression.getText(ast) === "URL" && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(ast);
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      if (tag === "Route") routes.push({ file: relative(file), line, jsx: node.getText(ast) });
      if (relative(file).startsWith("src/pages/")) {
        for (const attr of attrs) {
          if (/^on(Click|Submit|Change|Select|Save|Delete|Export|Download|Print|Send|Toggle)$/.test(attr.name.getText(ast))) actions.push({ file: relative(file), line, tag, action: attr.name.getText(ast), handler: attr.initializer?.getText(ast) });
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  graph.set(path.normalize(file), links);
}
const reachable = new Set();
function visit(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const link of graph.get(file) || []) visit(link);
}
visit(path.join(root, "src/main.tsx"));
const audit = {
  generatedAt: new Date().toISOString(),
  caveat: "Static runtime graph from src/main.tsx. Unreachable modules are review candidates, not proof of safe deletion. Test setup, workers, nonliteral imports and external entry points need separate verification.",
  runtimeModuleCount: files.length,
  reachable: reachable.size,
  unreachable: files.filter(file => !reachable.has(path.normalize(file))).map(relative),
  routes,
  registeredRoutes,
  actions,
};
fs.mkdirSync(path.join(root, "output"), { recursive: true });
fs.writeFileSync(path.join(root, "output/erp-page-action-audit.json"), JSON.stringify(audit, null, 2) + "\n");
console.log(JSON.stringify({ modules: files.length, reachable: reachable.size, candidates: audit.unreachable, actions: actions.length, routeDeclarations: routes.length }, null, 2));
