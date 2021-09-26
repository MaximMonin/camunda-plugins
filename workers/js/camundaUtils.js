'use strict';

const { File } = require('camunda-external-task-client-js');

const isUndefinedOrNull = a => typeof a === 'undefined' || a === null;

const typeMatchers = {
  null: isUndefinedOrNull,

  /**
   * @returns {boolean} true if value is Integer
   */
  integer(a) {
    return (
      Number.isInteger(a) && a >= -Math.pow(2, 31) && a <= Math.pow(2, 31) - 1
    );
  },

  /**
   * @returns {boolean} true if value is Long
   */
  long(a) {
    return Number.isInteger(a) && !typeMatchers.integer(a);
  },

  /**
   * @returns {boolean} true if value is Double
   */
  double(a) {
    return typeof a === 'number' && !Number.isInteger(a);
  },

  /**
   * @returns {boolean} true if value is Boolean
   */
  boolean(a) {
    return typeof a === 'boolean';
  },

  /**
   * @returns {boolean} true if value is String
   */
  string(a) {
    return typeof a === 'string';
  },

  /**
   * @returns {boolean} true if value is File
   */
  file(a) {
    return a instanceof File;
  },

  /**
   * @returns {boolean} true if value is Date.
   * */
  date(a) {
    return a instanceof Date;
  },

  /**
   * @returns {boolean} true if value is JSON
   */
  json(a) {
    return typeof a === 'object';
  }
};

/**
 * @returns the type of the variable
 * @param variable: external task variable
 */
const getVariableType = variable => {
  const match = Object.entries(
    typeMatchers
  ).filter(([matcherKey, matcherFunction]) => matcherFunction(variable))[0];

  return match[0];
};

module.exports = {
  getVariableType
};
