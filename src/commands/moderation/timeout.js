const { ms } = require("@naval-base/ms");
const Command = require("../../struct/Command");
const Permissions = require("../../struct/Permissions");
const Moderation = require("../../struct/Moderation");
const TimeoutScheduler = require("../../struct/TimeoutScheduler");

class TimeoutCommand extends Command {
  constructor() {
    super("timeout", {
      aliases: ["timeout"],
      category: "moderation",
      channel: "guild",
      ownerOnly: false,
      args: [
        {
          id: "member",
          type: "nonModMember",
          prompt: {
            start: "What member would you like to mute?",
            retry: (message, { failure }) => `${failure.value} Try again...`,
          },
        },
        {
          id: "channel",
          type: "channel",
          prompt: {
            start: "What channel do you want to time them out from?",
            retry: "That's like, not a channel man...",
          },
        },
        {
          id: "duration",
          type: (_, str) => {
            if (!str) return null;
            const duration = ms(str);
            if (duration && duration >= 300000 && !isNaN(duration)) return duration;
            return null;
          },
          prompt: {
            start: `For how long do you want the mute to last? (seconds, minutes, hours, days) Must be longer than 5 minutes..`,
            retry: `Please use a proper time format! (seconds, minutes, hours days) Must be longer than 5 minutes..`,
          },
        },
        {
          id: "quick",
          match: "flag",
          flag: ["--q", "--quick", "-q", "-quick", "-f", "--f"],
        },
      ],
      description: {
        content: `Mute a member so they cannot send messages and DM them with a separate reason.`,
        usage: "<Member>",
        examples: ["@User 20m", "@Member 10m", "1234515132412 1h", "eclipse 2h", "eclipse#1995 45m"],
      },
    });
    this.protected = false;
    this.whitelist = true;
  }

  userPermissions(message) {
    const canBeRun = Permissions.canRun(this, message.guild, message.channel, message.member);
    if (canBeRun === true) return null;
    return "NoPerms";
  }

  async exec(message, { member, channel, duration, quick }) {
    // Use webhook to avoid getting ratelimited
    const webhook = await this.client.messageUtils.fetchWebhook(message.channel, "Asuka");

    const isMuted = await TimeoutScheduler.fetchMute(member, channel.id); // Check if member is already muted
    if (isMuted) return webhook.send(`Error: This member is already muted in this channel!`);

    // If quick, apply mute, log and skip rest
    if (quick) {
      // Post Case to backend
      const createdCase = await Moderation.createCase(
        // Create new case entry in DB
        member,
        member.guild,
        "Timeout",
        "Quick Timeout -- Edit reason to complete",
        "Quick Timeout -- Please DM user to complete",
        null,
        duration,
        channel.id,
        0,
        message.member
      );

      if (createdCase === "NO_CHANNEL")
        return webhook.send(`**Error:** Please configure the case logs channel for this bot!`);
      else await TimeoutScheduler.scheduleMute(member, duration, channel.id, createdCase.caseID); // If case created succesfully, schedule the mute...
      await channel
        .createOverwrite(member, {
          SEND_MESSAGES: false,
          ADD_REACTIONS: false,
        })
        .catch((e) => {
          return webhook.send(
            `**Error:** I was not able to update the channel overrides for this user. Please check that I have permissions...`
          );
        });
      return webhook.send(`${member} **Anta Baka!?**`);
    }

    // Post History
    const userCaseHistory = await Moderation.fetchCaseHistory(message.guild, member);
    await webhook.send(userCaseHistory);

    // Get reason
    await webhook.send(
      `__**Please review the above information...**__\nIf you believe this is the proper action,\n**Enter the reason now or type \`cancel\` to quit...**`
    );

    const reasonFilter = (m) => m.author.id === message.author.id && m.content.length > 0;
    const reason = await this.client.messageUtils.getValidReason(message.channel, reasonFilter);
    if (!reason || reason === "CANCEL") return webhook.send(`Command Cancelled...`);

    // Get Screenshot
    await webhook.send(`__Please upload a screenshot of the context if applicable or type \`skip\` to skip...__`);

    const screenshotFilter = (m) => m.author.id === message.author.id;
    const screenshot = await this.client.messageUtils.getImageInput(message.channel, screenshotFilter);
    if (!screenshot || screenshot === "CANCEL") return webhook.send(`Command Cancelled...`);

    // Get DM Reason
    await webhook.send(
      `__**Please enter the message to be DM'd to this user.**__\n**Enter the reason now or type \`cancel\` to quit...**`
    );

    const dmReason = await this.client.messageUtils.getValidReason(message.channel, reasonFilter);
    if (!dmReason || dmReason === "CANCEL") return webhook.send(`Command Cancelled...`);

    // Post Case to backend
    const createdCase = await Moderation.createCase(
      member,
      member.guild,
      "Timeout",
      reason,
      dmReason,
      screenshot !== "SKIP" ? screenshot : null, // If screenshot provided, (will only ever be SKIP or a url..), include it otherwise null
      duration,
      channel.id,
      0,
      message.member
    );

    if (createdCase === "NO_CHANNEL") return webhook.send(`**Error:** Please configure the case logs channel for this bot!`);
    await TimeoutScheduler.scheduleMute(member, duration, channel.id, createdCase.caseID); // If case created succesfully, schedule the mute...

    await channel
      .createOverwrite(member, {
        SEND_MESSAGES: false,
        ADD_REACTIONS: false,
      })
      .catch((e) => {
        return webhook.send(
          `**Error:** I was not able to update the channel overrides for this user. Please check that I have permissions...`
        );
      });

    await member
      .send(
        `You have been timedout in the channel ${channel} in ${member.guild.name} for **${ms(
          duration
        )}**!\nReason: ${dmReason}\nYou may open a ticket in #tickets if you wish to appeal this temporary mute. Arguing will result in longer mutes, kicks or bans.\nPlease refer to the rules/info to avoid further infractions.`
      )
      .catch((e) => {
        webhook.send(
          `This user has DMs disabled! Please try to contact them through other means.\nThe DM reason has not been sent however this action has been recorded...`
        );
      });
    return webhook.send(`${member} **Anta Baka!?**`);
  }
}

module.exports = TimeoutCommand;