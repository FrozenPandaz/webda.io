import * as assert from "assert";
import { suite, test } from "mocha-typescript";
import { WebdaSampleApplication } from "../index.spec";
import { DeploymentManager } from "./deploymentmanager";

@suite
class DeploymentManagerTest {
  @test
  testGetDeployers() {
    assert.throws(
      () => new DeploymentManager(__dirname, "test"),
      /Not a webda application folder/g
    );
    assert.throws(
      () => new DeploymentManager(WebdaSampleApplication.getAppPath(), "test"),
      /Unknown deployment/g
    );
    let deploymentManager = new DeploymentManager(
      WebdaSampleApplication.getAppPath(),
      "Production"
    );
    assert.equal(Object.keys(deploymentManager.deployers).length, 4);
    assert.throws(
      () => deploymentManager.getDeployer("plop"),
      /Unknown deployer/g
    );
    assert.notEqual(deploymentManager.getDeployer("Packager"), undefined);
  }
}
