const tg = require(`../tg`);
import {TelegramClient} from 'messaging-api-telegram'

export default function (text) {
    const key = tg['telegram_bot_key']
    const chat_id = tg['telegram_channel_id']
    const client = TelegramClient.connect(key)

    console.log('test_markdown')
    client.sendMessage(
        chat_id,
        text,
        {
            parse_mode: 'Markdown'
        }
    );
}
