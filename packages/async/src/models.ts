import { CoreModel } from "@webda/core";

/**
 * Represent an item for processing queue
 */
export interface AsyncActionQueueItem {
  /**
   * Item to launch
   */
  uuid: string;
  /**
   * Secret key for status hook
   */
  __secretKey: string;
  /**
   * Type of action
   */
  type: string;
}

/**
 * Job information
 */
export interface Job {}

/**
 * Define here a model that can be used along with Store service
 */
export default class AsyncAction extends CoreModel {
  /**
   * Current status
   */
  public status: "RUNNING" | "SUCCESS" | "ERROR" | "QUEUED" | "STARTING" | "TIMEOUT";

  /**
   * Job information
   */
  public job: Job;

  /**
   * Last time the job was updated
   */
  public _lastJobUpdate: number;
  /**
   * Results from the job
   */
  public results: any;

  /**
   * Job current status
   */
  public statusDetails: any;

  /**
   *
   */
  public type: string;

  /**
   *
   */
  public arguments: any[];

  /**
   * Current logs
   */
  public logs: string[];

  /**
   * Secret key to post feedback
   */
  public __secretKey: string;

  /**
   * Expected action for the job
   *
   * It should be a verb
   */
  public action?: "STOP" | string;
}

export { AsyncAction };