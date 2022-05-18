import { suite, test } from "@testdeck/mocha";
import * as assert from "assert";
import * as sinon from "sinon";
import { Inject, Service } from "..";
import { WebdaTest } from "../test";
import { ServiceParameters } from "./service";

class FakeServiceParameters extends ServiceParameters {
  bean: string;
}

class FakeService<T extends FakeServiceParameters = FakeServiceParameters> extends Service<T> {
  @Inject("Authentication2", true)
  serv: Service;
  @Inject("bean", "Authentication", true)
  serv2: Service;
  @Inject("params:bean", undefined, true)
  serv3: Service;
  @Inject("params:bean", undefined, false)
  serv4: Service;
}

class FakeService2 extends Service {
  @Inject("Authentication2")
  serv: Service;
}

@suite
class ServiceTest extends WebdaTest {
  @test
  async injector() {
    let service = new FakeService(this.webda, "plop");
    assert.throws(() => service.resolve(), /Injector did not found bean 'undefined'\(parameter:bean\) for 'plop'/);
    service = new FakeService(this.webda, "plop", { bean: "Authentication" });
    service.resolve();
    assert.strictEqual(service.serv, undefined);
    assert.throws(
      () => new FakeService2(this.webda, "kf").resolve(),
      /Injector did not found bean 'Authentication2' for 'kf'/
    );
  }

  @test
  async clean() {
    let service = new FakeService(this.webda, "plop");
    // @ts-ignore
    const origin = global.it;
    // @ts-ignore
    global.it = undefined;
    assert.rejects(() => service.__clean(), /Only for test purpose/);
    // @ts-ignore
    global.it = origin;
    await service.__clean();
  }

  @test
  toPublicJSON() {
    let service = new FakeService(this.webda, "plop", {});
    let stub = sinon.stub(this.webda, "toPublicJSON").callsFake(() => "plop");
    try {
      assert.strictEqual(service.toPublicJSON({ l: "p" }), "plop");
    } finally {
      stub.restore();
    }
  }

  @test
  toStringMethod() {
    let service = new FakeService(this.webda, "plop", { type: "FakeService" });
    assert.strictEqual(service.toString(), "FakeService[plop]");
  }

  /**
   * Ensure a message is displayed if listener is long
   * Ensure error in listener are catched
   */
  @test
  async longListener() {
    let service = new FakeService(this.webda, "plop", {});
    let logs = [];
    service.log = (...args) => {
      logs.push(args);
    };
    service.on("test", async () => {
      await new Promise(resolve => setTimeout(resolve, 140));
      throw new Error("My error");
    });
    await service.emitSync("test", undefined);
    assert.strictEqual(logs.length, 2);
    assert.deepStrictEqual(
      logs.map(l => `${l[0]}_${l[1]}`),
      ["ERROR_Listener error", "INFO_Long listener"]
    );
  }
}
