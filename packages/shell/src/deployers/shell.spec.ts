import * as assert from "assert";
import { suite, test } from "mocha-typescript";
import { DeploymentManager } from "../handlers/deploymentmanager";
import { DeployerTest } from "./deployer.spec";
import ShellDeployer from "./shell";

@suite
class ShellDeployerTest extends DeployerTest<ShellDeployer> {
  async getDeployer(manager: DeploymentManager) {
    return new ShellDeployer(manager, {
      scripts: ["ls -alh", "cp plop"]
    });
  }

  @test
  async deploy() {
    this.deployer.execute = this.mockExecute;
    await this.deployer.deploy();
    assert.deepEqual(this.execs, [["ls -alh"], ["cp plop"]]);
    this.deployer.resources.scripts = undefined;
    this.execs = [];
    await this.deployer.deploy();
    assert.deepEqual(this.execs, []);
  }
}
