package camunda.plugin.incident;

import org.camunda.bpm.BpmPlatform;
import org.camunda.bpm.engine.ProcessEngine;
import org.camunda.bpm.engine.RuntimeService;
import org.camunda.bpm.engine.RepositoryService;
import org.camunda.bpm.engine.impl.incident.DefaultIncidentHandler;
import org.camunda.bpm.engine.impl.incident.IncidentContext;
import org.camunda.bpm.engine.runtime.Incident;
import org.camunda.bpm.engine.variable.VariableMap;
import org.camunda.bpm.engine.variable.Variables;

import java.util.HashMap;

public class ProcessIncidentHandler extends DefaultIncidentHandler {

    public ProcessIncidentHandler(String type){
	super(type);
    }

    @Override
    public String getIncidentHandlerType() {
	return super.getIncidentHandlerType();
    }

    @Override
    public Incident handleIncident(IncidentContext context, String message) {
	Incident incident = super.handleIncident(context, message);

	// if IncidentHandler Model has errors then will be infinite cycle
        String processKey = BpmPlatform.getDefaultProcessEngine().getRepositoryService().getProcessDefinition(incident.getProcessDefinitionId()).getKey();
	if (processKey.startsWith("Service.IncidentHandler")) {
	  return incident;
	}
        var map = new HashMap<String, String>();
        map.put("id", incident.getId());
        map.put("message", incident.getIncidentMessage());
        map.put("processId", incident.getProcessInstanceId());
        map.put("processKey", processKey);

	VariableMap variables = Variables.createVariables().putValue("incident", map);
        try {
	    BpmPlatform.getDefaultProcessEngine().getRuntimeService().startProcessInstanceByKey("Service.IncidentHandler", variables);
        }
        catch (Exception e) {
        }
	return incident;
    }
}

