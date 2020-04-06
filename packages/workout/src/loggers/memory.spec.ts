import * as assert from "assert";
import { suite, test } from "mocha-typescript";
import { WorkerOutput } from "..";
import { MemoryLogger } from "./memory";

@suite
class MemoryConsoleTest {
  output: WorkerOutput;
  calls: any[];
  before() {
    this.output = new WorkerOutput();
  }

  @test
  testLogsOnlyAndFilter() {
    let logger = new MemoryLogger(this.output);
    this.output.log("DEBUG", "Test 1");
    assert.equal(logger.getMessages().length, 1);
    assert.equal(logger.getLogs().length, 1);
    this.output.openGroup("Group 1");
    assert.equal(logger.getMessages().length, 1);
    assert.equal(logger.getLogs().length, 1);
    this.output.log("TRACE", "Test 1");
    assert.equal(logger.getMessages().length, 1);
    assert.equal(logger.getLogs().length, 1);
    this.output.log("ERROR", "Test 1");
    this.output.log("WARN", "Test 1");
    this.output.log("INFO", "Test 1");
    this.output.log("DEBUG", "Test 1");
    assert.equal(logger.getLogs().length, 5);
  }

  @test
  testAllMessagesLimit() {
    let logger = new MemoryLogger(this.output, true, "TRACE", 3);
    this.output.log("DEBUG", "Test 1");
    assert.equal(logger.getMessages().length, 1);
    assert.equal(logger.getLogs().length, 1);
    this.output.openGroup("Group 1");
    assert.equal(logger.getMessages().length, 2);
    assert.equal(logger.getLogs().length, 1);
    this.output.log("TRACE", "Test 2");
    assert.equal(logger.getMessages().length, 3);
    assert.equal(logger.getLogs().length, 2);
    this.output.log("WARN", "Test 3");
    this.output.log("INFO", "Test 4");
    assert.equal(logger.getMessages().length, 3);
    assert.equal(logger.getLogs().length, 3);
    logger.clear();
    assert.equal(logger.getMessages().length, 0);
    assert.equal(logger.getLogs().length, 0);
  }
}
