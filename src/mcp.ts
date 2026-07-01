export const MCP_MANIFEST = {
  schema_version: "v1",
  name_for_model: "backlink",
  name_for_human: "Backlink Radio",
  description_for_model:
    "Interact with Backlink, an AI-curated IPTV radio service. Select stations, filter by genre, get now-playing info, and ask the AI curator to pick the best station for a mood.",
  description_for_human: "AI-curated live radio from the iptv-org catalog.",
  auth: { type: "none" },
  api: { type: "openapi", url: "/openapi.json" },
  tools: [
    {
      name: "station_select",
      description: "Set the currently playing station by name.",
      input_schema: {
        type: "object",
        properties: {
          station_name: {
            type: "string",
            description: "Partial or full name of the station to select.",
          },
        },
        required: ["station_name"],
      },
    },
    {
      name: "now_playing",
      description:
        "Get the currently playing station including name, genre, stream URL, and country.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "genre_filter",
      description:
        "Return a list of stations filtered by genre keyword (e.g. jazz, news, classical).",
      input_schema: {
        type: "object",
        properties: {
          genre: {
            type: "string",
            description: "Genre keyword to filter by.",
          },
        },
        required: ["genre"],
      },
    },
    {
      name: "curator_prompt",
      description:
        "Ask the AI curator to pick and set the best station for a given mood or context.",
      input_schema: {
        type: "object",
        properties: {
          mood: {
            type: "string",
            description:
              "Describe the mood, activity, or vibe (e.g. focus work, late night jazz, morning energy).",
          },
          genre: {
            type: "string",
            description: "Optional genre to constrain the selection.",
          },
        },
        required: ["mood"],
      },
    },
  ],
};
