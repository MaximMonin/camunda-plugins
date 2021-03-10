const { InternalService } = require ('./InternalService.js');

function router(task, taskService, redis) {
  const { topicName, processDefinitionKey } = task;

//  console.log (JSON.stringify(task));

  switch (topicName) {
    case 'InternalService':
    InternalService(task, taskService, redis);
    break;
  default:
    {
      console.log('Unknown service ' + topicName + ' in Process ' + processDefinitionKey);
      taskService.handleFailure(task, {
        errorMessage: 'Unknown service ' + topicName + ' in Process ' + processDefinitionKey,
        errorDetails: '',
        retries: 0
      });
    }
  }
}

module.exports = { router };
