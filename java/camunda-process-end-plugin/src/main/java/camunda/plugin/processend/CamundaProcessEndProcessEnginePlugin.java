package camunda.plugin.processend;

import org.camunda.bpm.engine.ProcessEngine;
import org.camunda.bpm.engine.RuntimeService;
import org.camunda.bpm.engine.impl.cfg.ProcessEngineConfigurationImpl;
import org.camunda.bpm.engine.impl.cfg.ProcessEnginePlugin;
import org.camunda.bpm.engine.impl.history.HistoryLevel;
import org.camunda.bpm.engine.impl.history.handler.CompositeDbHistoryEventHandler;

import java.util.Arrays;

public class CamundaProcessEndProcessEnginePlugin implements ProcessEnginePlugin {

	private ProcessEndEventHandler customHistoryEventHandler;

	@Override
	public void preInit(ProcessEngineConfigurationImpl processEngineConfiguration) {
        }

	@Override
	public void postInit(ProcessEngineConfigurationImpl processEngineConfiguration) {
		customHistoryEventHandler = new ProcessEndEventHandler();
		processEngineConfiguration
				.setHistoryEventHandler(new CompositeDbHistoryEventHandler(customHistoryEventHandler));
	}

	@Override
	public void postProcessEngineBuild(ProcessEngine processEngine) {
        }
}
