/* * * * * * * * * * * * * * * * * * * * * * * * * * *\
*                                                     *
*                   Version 1.0.0                     *
*                                                     *
* This is a bot developed for the game Screeps.       *
*                                                     *
* Use this config-file to configure your bot, options *
* are expained below.                                 *
*                                                     *
*                                                     *
* Version history:                                    *
*                                                     *
\* * * * * * * * * * * * * * * * * * * * * * * * * * */

const config = {

	/**
	 * The signature text the controllers will be signed with, including claimed and reserved rooms.
	 * @type {string}
	 * @default ""
	 */
	signature: "[两仪 / Li0ngY1Bot] Allies: @creepebucket @Static1248",

	/**
	 * The outposts of each main room.
	 * Outposts are rooms that are reserved and mined by the main room colony.
	 * keys: main room name
	 * values: array of outpost room names
	 * Example:
	 * {
	 * 	"W34S27": ["W33S27", "W32S27"]
	 * }
	 * @type {Record<string, string[]>}
	 * @default {}
	 * */
	outposts: {
		"W34S27": ["W33S27", "W32S27"]
	} as Record<string, string[]>,

}

export default config;
