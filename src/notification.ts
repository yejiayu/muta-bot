const config = require(`../tg`);
import {TelegramClient} from 'messaging-api-telegram'

export default function (text) {
    const key = config['telegram_bot_key']
    const chat_id = config['telegram_channel_id']
    console.log(key)
    const client = TelegramClient.connect(key)


    client.sendMessage(
        chat_id,
        text,
        {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            disable_notification: false,
        }
    );
}
