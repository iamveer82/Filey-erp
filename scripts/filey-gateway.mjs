/* Filey gateway — the terminal door to the same channels as the desktop app.
 * WhatsApp stays inside the app so one pairing answers messages. This command
 * tells you the free setup for each channel. No paid channel key. */
const channels = {
  whatsapp: "No API key. Open the Filey desktop app → Integrations → Built-in connections → Connect WhatsApp, then scan the QR from WhatsApp → Linked devices.",
  telegram: "No paid API. Message @BotFather, create a bot, and paste the free token into Built-in connections.",
  slack: "No paid API. Create a free incoming webhook in Slack and paste the hooks.slack.com address into Built-in connections.",
  discord: "No paid API. Create a free channel webhook in Discord and paste the discord.com address into Built-in connections.",
  teams: "No paid API. Create a free incoming webhook in Teams and paste the office.com address into Built-in connections.",
  email: "Connect the mailbox in Built-in connections. Filey sends through that account.",
};

const [command = "status", name] = process.argv.slice(2);

function printAll() {
  console.log("Filey gateway. The desktop app is the agent. Channels use a free link you own.\n");
  for (const [id, steps] of Object.entries(channels)) console.log(`${id}\n  ${steps}\n`);
  console.log("Setup one channel: npm run gateway -- setup whatsapp");
}

if (command === "status" || command === "setup" && !name) printAll();
else if (command === "setup" && name in channels) console.log(channels[name]);
else if (command === "start" && name === "whatsapp") {
  console.log(channels.whatsapp);
  console.log("\nThe pairing stays in the desktop app so Filey can answer. This terminal does not start a second WhatsApp session.");
} else if (command === "start") {
  console.log(name && name in channels ? channels[name] : "Choose whatsapp, telegram, slack, discord, teams or email.");
} else {
  console.log("Usage: npm run gateway -- status | setup [channel] | start whatsapp");
  process.exitCode = command === "help" ? 0 : 1;
}
