import * as assert from "assert";
import { suite, test } from "mocha-typescript";
import { GetAWS } from "../index";
import { checkLocalStack, WebdaAwsTest } from "../index.spec";
import { CloudWatchLogger } from "./cloudwatchlogger";

@suite
class CloudWatchLoggerTest extends WebdaAwsTest {
  service: CloudWatchLogger;

  getTestConfiguration() {
    return process.cwd() + "/test/config-cloudwatch.json";
  }

  async before() {
    await checkLocalStack();
    let cloudwatch = new (GetAWS({
      accessKeyId: "Bouzouf",
      secretAccessKey: "plop"
    }).CloudWatchLogs)({
      endpoint: "http://localhost:4586"
    });
    try {
      await cloudwatch
        .deleteLogGroup({
          logGroupName: "webda-test"
        })
        .promise();
    } catch (err) {
      // Skip bad delete
    }
    await super.before();
    this.service = <CloudWatchLogger>this.getService("CloudWatchLogger");
    assert.notEqual(this.service, undefined);
  }

  @test
  async basic() {
    this.webda.log("TEST", "Plop 0", "Test");
    this.webda.log("TEST2", "Plop 1", "Test");
    this.webda.log("TEST2", "Plop 2", "Test");
    this.webda.log("TEST2", "Plop 3", "Test");
    this.webda.log("TEST2", "Plop 4", "Test");
    await this.webda.emitSync("Webda.Result");
    let res = await this.service._cloudwatch
      .describeLogStreams({
        logGroupName: "webda-test"
      })
      .promise();
    assert.equal(res.logStreams.length, 1);
    assert.notEqual(res.logStreams[0].lastEventTimestamp, undefined);
  }

  @test
  async secondRun() {
    // Update config to use the stepper
    this.service._params.singlePush = true;
    this.webda.log("TEST", "Plop 0", "Test");
    this.webda.log("TEST2", "Plop 1", "Test");
    await this.sleep(1000);
    let res = await this.service._cloudwatch
      .describeLogStreams({
        logGroupName: "webda-test"
      })
      .promise();
    assert.equal(res.logStreams.length, 1);
    assert.notEqual(res.logStreams[0].lastEventTimestamp, undefined);
    this.webda.log("TEST2", "Plop 2", "Test");
    this.webda.log("TEST2", "Plop 3", "Test");
    this.webda.log("TEST2", "Plop 4", "Test");
    await this.webda.emitSync("Webda.Result");
    res = await this.service._cloudwatch
      .describeLogStreams({
        logGroupName: "webda-test"
      })
      .promise();
    assert.equal(res.logStreams.length, 1);
  }
}
