import { suite, test } from "@testdeck/mocha";
import { Compiler } from "./compiler";
import { SourceApplication } from "./sourceapplication";
import * as ts from "typescript";
import * as path from "path";
import * as assert from "assert";
import { WebdaSampleApplication } from "../index.spec";

@suite
class CompilerTest {
  @test
  async compilerCov() {
    const node: ts.Node = {
      kind: ts.SyntaxKind.QualifiedName,
      left: {
        kind: ts.SyntaxKind.AnyKeyword,
        getText: () => "Plop"
      },
      getText: () => "Plop",
      parent: {
        kind: ts.SyntaxKind.AnyKeyword,
        getText: () => "Plop",
        // @ts-ignore
        parent: {
          kind: ts.SyntaxKind.AnyKeyword,
          getText: () => "Plop"
        }
      }
    };
    let app = new SourceApplication(WebdaSampleApplication.getAppPath(), undefined);
    await app.load();
    let compiler = new Compiler(app);
    compiler.compile();
    compiler.displayParents(node);
    assert.strictEqual(compiler.getParent(node, ts.SyntaxKind.AnyKeyword), node.parent);
    assert.strictEqual(compiler.getParent(node, ts.SyntaxKind.AmpersandAmpersandEqualsToken), undefined);
    compiler.displayTree(node);
    assert.strictEqual(compiler.getServiceTypePattern("Webda/Test"), "^([wW][eE][bB][dD][aA]/)?[tT][eE][sS][tT]$");
    assert.strictEqual(
      compiler.getServiceTypePattern("ReTest"),
      "^([wW][eE][bB][dD][aA][dD][eE][mM][oO]/)?[rR][eE][tT][eE][sS][tT]$"
    );

    compiler.getPackageFromType({
      // @ts-ignore
      symbol: {
        getDeclarations: () => []
      }
    });

    compiler.getPackageFromType({
      // @ts-ignore
      symbol: {
        getDeclarations: () => [
          {
            // @ts-ignore
            getSourceFile: () => ({
              fileName: "/notexisting/path/for/cov"
            })
          }
        ]
      }
    });

    assert.ok(
      compiler
        .getJSTargetFile(compiler.tsProgram.getSourceFiles().filter(f => !f.isDeclarationFile)[0], true)
        .endsWith("sample-app/lib/models/contact.js")
    );
    assert.ok(
      compiler
        .getJSTargetFile(compiler.tsProgram.getSourceFiles().filter(f => !f.isDeclarationFile)[0])
        .endsWith("lib/models/contact.js")
    );
  }

  @test
  async specificCases() {
    const app = new SourceApplication(path.join(__dirname, "..", "..", "..", "..", "test", "compiler"), undefined);
    await app.load();
    let compiler = new Compiler(app);
    compiler.compile();
    let mod = compiler.generateModule();
    // Goodbean should be use the SubDefinition
    assert.strictEqual(mod.schemas["beans/goodbean"].required.length, 3);
    // Ensure we manage failure in schema
    compiler.schemaGenerator.createSchemaFromNodes = () => {
      throw new Error();
    };
    compiler.generateModule();
    // Check if getSchema return null: 747
    // Check if getSchema return object without properties: 751
  }
}