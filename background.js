chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('reminder_')) {
    const taskId = alarm.name.replace('reminder_', '');
    chrome.storage.local.get(['tasks'], (result) => {
      const tasks = result.tasks || [];
      const task = tasks.find(t => t.id == taskId);
      if (task) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: '⏰ تذكير: ' + task.title,
          message: task.project ? 'المشروع: ' + task.project : 'حان وقت المهمة!',
          priority: 2
        });
      }
    });
  } else if (alarm.name === 'pomodoro_end') {
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/icon48.png',
      title: '🍅 انتهى البومودورو!',
      message: 'أحسنت! حان وقت الراحة.', priority: 2
    });
  } else if (alarm.name === 'break_end') {
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/icon48.png',
      title: '⚡ انتهت الاستراحة!',
      message: 'هيا نعمل مجددًا!', priority: 2
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SET_ALARM') {
    chrome.alarms.create(msg.name, { when: msg.when });
    sendResponse({ ok: true });
  } else if (msg.type === 'CLEAR_ALARM') {
    chrome.alarms.clear(msg.name);
    sendResponse({ ok: true });
  }
  return true;
});