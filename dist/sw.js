// Service Worker for Three Good Things (TGT) Web App & Web Push Notifications
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 1. バックグラウンドからの Web Push 通知受信イベントハンドラ
self.addEventListener('push', (event) => {
  let title = '【今日の記録】リマインダー';
  let options = {
    body: '今日の良かったこと3つを振り返って記録しましょう！🌿',
    icon: '/icons.svg',
    badge: '/favicon.svg',
    tag: 'tgt-daily-reminder',
    renotify: true,
    data: { url: '/' }
  };

  if (event.data) {
    try {
      const data = event.data.json();
      if (data.title) title = data.title;
      if (data.body) options.body = data.body;
      if (data.url) options.data.url = data.url;
    } catch (e) {
      const textData = event.data.text();
      if (textData) options.body = textData;
    }
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// 2. 通知タップ時の挙動 (アプリウィンドウにフォーカスまたは新規オープン)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        let client = clientList[i];
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
