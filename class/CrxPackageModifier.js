class CrxPackageModifier {
    static FOLDER_META = 'META-INF';
    static FILE_FILTER = CrxPackageModifier.FOLDER_META + '/vault/filter.xml';

    constructor(config) {
        this.config = config || {};
    }

    async modify(value, target) {
        if (!value || !target || value.constructor.name !== 'Blob' || !JSZip) {
            return value;
        }

        try {

            const sourceZip = await JSZip.loadAsync(value);

            // Create new zip file based on <ETA-INF folder from the orig file
            const targetZip = new JSZip();
            await targetZip.folder(CrxPackageModifier.FOLDER_META).loadAsync(await sourceZip.folder(CrxPackageModifier.FOLDER_META).generateAsync({type: 'arraybuffer'}));

            // Extract filter roots
            let filterText = await targetZip.file(CrxPackageModifier.FILE_FILTER).async('string');
            const filterRoots = Array.from(filterText.matchAll(/<filter\s+root\s*=\s*"(.+?)".*\/>/g), match => match[1])
                .map(str => {return {path: str, nodeName: str.split('/').slice(-1)}});

            // Store filter roots to the new zip file
            const newFilterEntries = filterRoots.map(root => target + '/' + root.nodeName).map(str => `<filter root="${str}"/>`).join('\n');
            filterText = filterText.replace(/<filter.+\/>/s, newFilterEntries);
            targetZip.file(CrxPackageModifier.FILE_FILTER, filterText);

            // Move contents of filter roots to the new package under the target folder
            const targetFolderPath = CrxPackageModifier.getTargetFolderPath(target);
            for (let filterRoot of filterRoots) {
                const sourceDirBinary = await sourceZip
                    .folder(CrxPackageModifier.getTargetFolderPath(filterRoot.path))
                    .generateAsync({type: 'arraybuffer'});
                await targetZip
                    .folder(targetFolderPath)
                    .folder(filterRoot.nodeName)
                    .loadAsync(sourceDirBinary);
            }

            // Export the results
            const exportOptions = {type: 'blob'};
            if (this.config.compression) {
                exportOptions.compression = 'DEFLATE';
            }
            return await targetZip.generateAsync(exportOptions);

        } catch (e) {
            console.error(e);
        }
        return value;
    }

    static getTargetFolderPath(target) {
        let targetFolder = target[0] === '/' ? target.substr(1) : target;
        if (!/^jcr_root/.test(targetFolder)) {
            targetFolder = 'jcr_root/' + targetFolder;
        }
        return targetFolder;
    }

    static getTargetNodeName(path) {

    }
}