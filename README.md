# Darkcord Collectors

### Example
```js
import { Client } from "darkcord";
import { CollectorPlugin } from "@darkcord/collectors";

const client = new Client("TOKEN", {
    gateway: {
        intents: [YOUR_INTENTS]
    },
    plugins: [CollectorPlugin]
});

client.on("messageCreate", (message) => {
    if (message.content === "!reactions") {
        const collector = message.createReactionCollector();

        collector.on("collect", collected => {
            console.log(collected.reaction);
        });
    }
})

client.connect();
```