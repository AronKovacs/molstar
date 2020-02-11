/**
 * Copyright (c) 2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { ParamDefinition as PD } from '../../../../../mol-util/param-definition'
import { PluginBehavior } from '../../../behavior';
import { ValidationReport, ValidationReportProvider } from '../../../../../mol-model-props/rcsb/validation-report';
import { RandomCoilIndexColorThemeProvider } from '../../../../../mol-model-props/rcsb/themes/random-coil-index';
import { GeometryQualityColorThemeProvider } from '../../../../../mol-model-props/rcsb/themes/geometry-quality';
import { Loci } from '../../../../../mol-model/loci';
import { OrderedSet } from '../../../../../mol-data/int';
import { ClashesRepresentationProvider } from '../../../../../mol-model-props/rcsb/representations/validation-report-clashes';
import { DensityFitColorThemeProvider } from '../../../../../mol-model-props/rcsb/themes/density-fit';
import { cantorPairing } from '../../../../../mol-data/util';

const Tag = ValidationReport.Tag

export const RCSBValidationReport = PluginBehavior.create<{ autoAttach: boolean, showTooltip: boolean }>({
    name: 'rcsb-validation-report-prop',
    category: 'custom-props',
    display: { name: 'RCSB Validation Report' },
    ctor: class extends PluginBehavior.Handler<{ autoAttach: boolean, showTooltip: boolean }> {
        private provider = ValidationReportProvider

        private label = (loci: Loci): string | undefined => {
            if (!this.params.showTooltip) return
            return [
                geometryQualityLabel(loci),
                densityFitLabel(loci),
                randomCoilIndexLabel(loci)
            ].filter(l => !!l).join('</br>')
        }

        register(): void {
            this.ctx.customModelProperties.register(this.provider, this.params.autoAttach);

            this.ctx.lociLabels.addProvider(this.label);

            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.add(Tag.DensityFit, DensityFitColorThemeProvider)
            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.add(Tag.GeometryQuality, GeometryQualityColorThemeProvider)
            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.add(Tag.RandomCoilIndex, RandomCoilIndexColorThemeProvider)

            this.ctx.structureRepresentation.registry.add(Tag.Clashes, ClashesRepresentationProvider)
        }

        update(p: { autoAttach: boolean, showTooltip: boolean }) {
            let updated = this.params.autoAttach !== p.autoAttach
            this.params.autoAttach = p.autoAttach;
            this.params.showTooltip = p.showTooltip;
            this.ctx.customStructureProperties.setDefaultAutoAttach(this.provider.descriptor.name, this.params.autoAttach);
            return updated;
        }

        unregister() {
            this.ctx.customStructureProperties.unregister(this.provider.descriptor.name);

            this.ctx.lociLabels.removeProvider(this.label);

            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.remove(Tag.DensityFit)
            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.remove(Tag.GeometryQuality)
            this.ctx.structureRepresentation.themeCtx.colorThemeRegistry.remove(Tag.RandomCoilIndex)

            this.ctx.structureRepresentation.registry.remove(Tag.Clashes)
        }
    },
    params: () => ({
        autoAttach: PD.Boolean(false),
        showTooltip: PD.Boolean(true),
        baseUrl: PD.Text(ValidationReport.DefaultBaseUrl)
    })
});

function geometryQualityLabel(loci: Loci): string | undefined {
    if (loci.kind === 'element-loci') {
        if (loci.elements.length === 0) return

        if (loci.elements.length === 1 && OrderedSet.size(loci.elements[0].indices) === 1) {
            const { unit, indices } = loci.elements[0]

            const validationReport = ValidationReportProvider.get(unit.model).value
            if (!validationReport) return

            const { bondOutliers, angleOutliers } = validationReport
            const eI = unit.elements[OrderedSet.start(indices)]
            const issues = new Set<string>()

            const bonds = bondOutliers.index.get(eI)
            if (bonds) bonds.forEach(b => issues.add(bondOutliers.data[b].tag))

            const angles = angleOutliers.index.get(eI)
            if (angles) angles.forEach(a => issues.add(angleOutliers.data[a].tag))

            if (issues.size === 0) {
                return `RCSB Geometry Quality <small>(1 Atom)</small>: no issues`;
            }

            const summary: string[] = []
            issues.forEach(name => summary.push(name))
            return `Geometry Quality <small>(1 Atom)</small>: ${summary.join(', ')}`;
        }

        let hasValidationReport = false
        const seen = new Set<number>()
        const cummulativeIssues = new Map<string, number>()

        for (const { indices, unit } of loci.elements) {
            const validationReport = ValidationReportProvider.get(unit.model).value
            if (!validationReport) continue
            hasValidationReport = true

            const { geometryIssues } = validationReport
            const residueIndex = unit.model.atomicHierarchy.residueAtomSegments.index
            const { elements } = unit

            OrderedSet.forEach(indices, idx => {
                const eI = elements[idx]

                const rI = residueIndex[eI]
                const residueKey = cantorPairing(rI, unit.id)
                if (!seen.has(residueKey)) {
                    const issues = geometryIssues.get(rI)
                    if (issues) {
                        issues.forEach(name => {
                            const count = cummulativeIssues.get(name) || 0
                            cummulativeIssues.set(name, count + 1)
                        })
                    }
                    seen.add(residueKey)
                }
            })
        }

        if (!hasValidationReport) return

        const residueCount = `<small>(${seen.size} ${seen.size > 1 ? 'Residues' : 'Residue'})</small>`

        if (cummulativeIssues.size === 0) {
            return `Geometry Quality ${residueCount}: no issues`;
        }

        const summary: string[] = []
        cummulativeIssues.forEach((count, name) => {
            summary.push(`${name}${count > 1 ? ` \u00D7 ${count}` : ''}`)
        })
        return `Geometry Quality ${residueCount}: ${summary.join(', ')}`;
    }
}

function densityFitLabel(loci: Loci): string | undefined {
    if (loci.kind === 'element-loci') {
        if (loci.elements.length === 0) return;

        const seen = new Set<number>()
        const rsrzSeen = new Set<number>()
        const rsccSeen = new Set<number>()
        let rsrzSum = 0
        let rsccSum = 0

        for (const { indices, unit } of loci.elements) {
            const validationReport = ValidationReportProvider.get(unit.model).value
            if (!validationReport) continue

            const { rsrz, rscc } = validationReport
            const residueIndex = unit.model.atomicHierarchy.residueAtomSegments.index
            const { elements } = unit

            OrderedSet.forEach(indices, idx => {
                const eI = elements[idx]
                const rI = residueIndex[eI]

                const residueKey = cantorPairing(rI, unit.id)
                if (!seen.has(residueKey)) {
                    const rsrzValue = rsrz.get(rI)
                    const rsccValue = rscc.get(rI)
                    if (rsrzValue !== undefined) {
                        rsrzSum += rsrzValue
                        rsrzSeen.add(residueKey)
                    } else if (rsccValue !== undefined) {
                        rsccSum += rsccValue
                        rsccSeen.add(residueKey)
                    }
                    seen.add(residueKey)
                }
            })
        }

        if (seen.size === 0) return

        const summary: string[] = []

        if (rsrzSeen.size) {
            const rsrzCount = `<small>(${rsrzSeen.size} ${rsrzSeen.size > 1 ? 'Residues avg.' : 'Residue'})</small>`
            const rsrzAvg = rsrzSum / rsrzSeen.size
            summary.push(`Real Space R ${rsrzCount}: ${rsrzAvg.toFixed(2)}`)
        }
        if (rsccSeen.size) {
            const rsccCount = `<small>(${rsccSeen.size} ${rsccSeen.size > 1 ? 'Residues avg.' : 'Residue'})</small>`
            const rsccAvg = rsccSum / rsccSeen.size
            summary.push(`Real Space Correlation Coefficient ${rsccCount}: ${rsccAvg.toFixed(2)}`)
        }

        if (summary.length) {
            return summary.join('</br>')
        }
    }
}

function randomCoilIndexLabel(loci: Loci): string | undefined {
    if (loci.kind === 'element-loci') {
        if (loci.elements.length === 0) return;

        const seen = new Set<number>()
        let sum = 0

        for (const { indices, unit } of loci.elements) {
            const validationReport = ValidationReportProvider.get(unit.model).value
            if (!validationReport) continue

            const { rci } = validationReport
            const residueIndex = unit.model.atomicHierarchy.residueAtomSegments.index
            const { elements } = unit

            OrderedSet.forEach(indices, idx => {
                const eI = elements[idx]
                const rI = residueIndex[eI]

                const residueKey = cantorPairing(rI, unit.id)
                if (!seen.has(residueKey)) {
                    const rciValue = rci.get(rI)
                    if (rciValue !== undefined) {
                        sum += rciValue
                        seen.add(residueKey)
                    }
                }
            })
        }

        if (seen.size === 0) return

        const residueCount = `<small>(${seen.size} ${seen.size > 1 ? 'Residues avg.' : 'Residue'})</small>`
        const rciAvg = sum / seen.size

        return `Random Coil Index ${residueCount}: ${rciAvg.toFixed(2)}`
    }
}