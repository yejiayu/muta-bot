const { TelegramClient } = require('messaging-api-telegram');

// get accessToken from telegram [@BotFather](https://telegram.me/BotFather)
const client = TelegramClient.connect('1100798747:AAGj6GGV50Y_aqtZDGMh-aW_WQecyFJycAE');
// const chatId = '@cosinyouth'
const chatId = -1001445330146
client.sendMessage(chatId, 'Hello I am bot').then(() => {
  console.log('sent');
});
return
client
  .getUpdates({
    limit: 10,
  })
  .then(updates => {
    console.log(updates[1],updates[2],updates[3],updates[4]);
    /*
      [
        {
          update_id: 513400512,
          message: {
            message_id: 3,
            from: {
              id: 313534466,
              first_name: 'first',
              last_name: 'last',
              username: 'username',
            },
            chat: {
              id: 313534466,
              first_name: 'first',
              last_name: 'last',
              username: 'username',
              type: 'private',
            },
            date: 1499402829,
            text: 'hi',
          },
        },
        ...
      ]
    */
  });
