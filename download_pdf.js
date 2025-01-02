const OUTPUT_OPTION = "Templated output path";

module.exports = {
	entry: async (QuickAdd, settings) => {
		const resp = await requestUrl(QuickAdd.variables.pdf_url);

		const outputPath = await QuickAdd.quickAddApi.format(
			settings[OUTPUT_OPTION],
			{ ...QuickAdd.variables },
		);

		await QuickAdd.app.vault.adapter.writeBinary(outputPath, resp.arrayBuffer);

		QuickAdd.variables = {
			...QuickAdd.variables,
			downloadedPdfPath: outputPath,
		};
	},
	settings: {
		name: "Download PDF",
		author: "Ryo Takahashi",
		options: {
			[OUTPUT_OPTION]: {
				type: "format",
				placeholder: "asset_folder/{{VALUE:bibtexKey}}.pdf",
			},
		},
	},
};
