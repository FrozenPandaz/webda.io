import { BinaryTest } from "./binary.spec";
import * as assert from "assert";
import { FileBinary } from "./filebinary";
import { suite, test } from "@testdeck/mocha";
import { removeSync } from "fs-extra";
import * as fs from "fs";

@suite
class FileBinaryTest extends BinaryTest {
  @test
  isValidChallenge() {
    let binary: FileBinary = <FileBinary>this.getService("binary");
    assert.strictEqual(
      binary._validChallenge("54b249c8a7c2cdc6945c5c426fbe2b4b41e5045059c43ddc5e134b17e8157980"),
      true
    );
    assert.strictEqual(
      binary._validChallenge("54b249c8a7c2cdc6945c5c426fbe2b4b41e5045059c43ddc5e134b17e815798G"),
      false
    );
    assert.strictEqual(
      binary._validChallenge("54b249c8a7c2cdc6945c5c426fbe2b4b41e5045059c43ddc5e134b17e815798"),
      false
    );
    assert.strictEqual(
      binary._validChallenge("54b249c8a7c2cdc6945c5c426fbe2b4b41e5045059c43ddc5e134b17e815798."),
      false
    );
  }

  // Test parent class

  @test
  initMap() {
    let binary = this.getBinary();
    binary.initMap(undefined);
    binary.initMap({ _init: true });
    // Bad store
    binary.initMap({
      VersionService: {},
      None: {},
      MemoryIdents: "idents"
    });
  }

  @test
  _getFile() {
    let binary = this.getBinary();
    const files = [{}];
    assert.strictEqual(binary._getFile({ files }), files[0]);
    const req = {
      body: "plop",
      headers: {
        contentType: "text/plain"
      }
    };
    assert.deepStrictEqual(binary._getFile(req), {
      buffer: "plop",
      mimetype: "text/plain",
      originalname: "",
      size: 4
    });
  }

  @test
  initRoutes() {
    let binary = this.getBinary();
    binary.getParameters().expose = undefined;
    binary.initRoutes();
    // @ts-ignore
    binary._name = "Binary";
    binary.initRoutes();
  }

  @test
  async verifyMapAndStore() {
    let binary = this.getBinary();
    let ctx = await this.newContext();
    ctx.setPathParameters({ store: "Store", property: "images" });
    console.log(binary.getParameters().map);
    assert.throws(() => binary._verifyMapAndStore(ctx), /404/);
    ctx.setPathParameters({ store: "users", property: "images" });
    assert.strictEqual(binary._verifyMapAndStore(ctx), this.getService("users"));
    ctx.setPathParameters({ store: "users", property: "images2" });
    assert.throws(() => binary._verifyMapAndStore(ctx), /404/);
    ctx.setPathParameters({ store: "notexisting", property: "images" });
    assert.throws(() => binary._verifyMapAndStore(ctx), /404/);
  }

  @test
  computeParameters() {
    let binary = <FileBinary>this.getBinary();
    removeSync(binary.getParameters().folder);
    binary.computeParameters();
    assert.ok(fs.existsSync(binary.getParameters().folder));
  }
}

export { FileBinaryTest };
