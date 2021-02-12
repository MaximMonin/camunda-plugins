package camunda.plugin.processend;

import org.camunda.bpm.engine.impl.history.event.*;
import org.camunda.bpm.engine.impl.history.handler.HistoryEventHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import redis.clients.jedis.Jedis;

import java.util.Base64;
import java.util.ArrayList;
import java.util.List;

public class ProcessEndEventHandler implements HistoryEventHandler {

  private static final Logger log = LoggerFactory.getLogger(ProcessEndEventHandler.class);
  private String[] redisUrls;  
  private String redisPassword; 
  private String gateUrl;
  private String auth;

  public ProcessEndEventHandler() {
     if (System.getenv("RedisUrls") != null) {
       redisUrls = System.getenv("RedisUrls").split(",");
     }
     redisPassword = System.getenv("RedisPass");
     gateUrl = System.getenv("SERVER");
     String username = "rpc";
     String password = "rpc";
     if (System.getenv("GATE_PASSWORD") != null) {
       password = new String(Base64.getDecoder().decode(System.getenv("GATE_PASSWORD")));
       password = password.substring(0, password.length() - 1);
     }
     auth = username + ":" + password;
     log.info ("GateUrl: " + gateUrl) ;
     if (redisUrls == null) {
       log.info ("RedisUrls: null");
     }
     else {
       log.info ("RedisUrls: " + String.join(",", redisUrls));
     }
  }

  @Override
  public void handleEvent(HistoryEvent historyEvent) {

    if (historyEvent instanceof HistoricProcessInstanceEventEntity) {
      HistoricProcessInstanceEventEntity processInstanceEventEntity =
        (HistoricProcessInstanceEventEntity) historyEvent;

      /* Process_end for top level process */
      if (historyEvent.getEventType().equals(HistoryEventTypes.PROCESS_INSTANCE_END.getEventName()) &&
          processInstanceEventEntity.getSuperProcessInstanceId() == null) {

        String processId = processInstanceEventEntity.getProcessInstanceId();
        String state = processInstanceEventEntity.getState();
        // log.info("Received <" + historyEvent.getEventType() + "> event for <" + processInstanceEventEntity.toString() + ">");
        // log.info("Process state: <" + state + ">");

        // Using Jedis to publish to multiply redis servers
        Boolean notifyDone = false;
        Jedis jedis;
        if (redisUrls != null) {
          try {
            for(int i = 0; i< redisUrls.length; i++) {
              if (redisPassword != null) {
                jedis = new Jedis("redis://" + redisUrls[i]);
              }
              else {
                jedis = new Jedis("redis://:" + redisPassword + "@" + redisUrls[i]);
              }
              jedis.publish("process" + processId, state);
              jedis.quit();
              notifyDone = true;
            }
          }
          catch(Exception e) {
            log.info (e.getMessage());
            notifyDone = false;
          }
        }

        // Using url to make https api call 
        if (! notifyDone && gateUrl != null) {
          String url = "https://" + gateUrl + "/api/camunda/process/" + processId + "/ends?state=" + state;
          if (! callApi (url, auth)) {
            /* repeat one more time */
            callApi (url, auth);
          }
        }
      }
    } 
  }
  private boolean callApi (String url, String auth) {
    String base64login = new String(Base64.getEncoder().encodeToString(auth.getBytes()));

    try {
       SSLHelper.getConnection(url)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("Authorization", "Basic " + base64login)
                .timeout(5000)
                .ignoreContentType(true) 
                .post();
       return true;
    }
    catch (Exception e) {
      log.info (e.toString());
      return false;
    }
  }

  @Override
  public void handleEvents(List<HistoryEvent> historyEvents) {
    for (HistoryEvent historyEvent : historyEvents) {
      handleEvent(historyEvent);
    }
  }
}
