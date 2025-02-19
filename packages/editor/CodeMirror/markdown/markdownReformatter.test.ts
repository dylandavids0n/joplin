import {
	findInlineMatch, MatchSide, RegionSpec, renumberSelectedLists, tabsToSpaces, toggleRegionFormatGlobally,
} from './markdownReformatter';
import { Text as DocumentText, EditorSelection, EditorState } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import createTestEditor from '../testUtil/createTestEditor';

describe('markdownReformatter', () => {

	jest.retryTimes(2);

	const boldSpec: RegionSpec = RegionSpec.of({
		template: '**',
	});

	it('matching a bolded region: should return the length of the match', () => {
		const doc = DocumentText.of(['**test**']);
		const sel = EditorSelection.range(0, 5);

		// matchStart returns the length of the match
		expect(findInlineMatch(doc, boldSpec, sel, MatchSide.Start)).toBe(2);
	});

	it('matching a bolded region: should match the end of a region, if next to the cursor', () => {
		const doc = DocumentText.of(['**...** test.']);
		const sel = EditorSelection.range(5, 5);
		expect(findInlineMatch(doc, boldSpec, sel, MatchSide.End)).toBe(2);
	});

	it('matching a bolded region: should return -1 if no match is found', () => {
		const doc = DocumentText.of(['**...** test.']);
		const sel = EditorSelection.range(3, 3);
		expect(findInlineMatch(doc, boldSpec, sel, MatchSide.Start)).toBe(-1);
	});

	it('should match a custom specification of italicized regions', () => {
		const spec: RegionSpec = {
			template: { start: '*', end: '*' },
			matcher: { start: /[*_]/g, end: /[*_]/g },
		};
		const testString = 'This is a _test_';
		const testDoc = DocumentText.of([testString]);
		const fullSel = EditorSelection.range('This is a '.length, testString.length);

		// should match the start of the region
		expect(findInlineMatch(testDoc, spec, fullSel, MatchSide.Start)).toBe(1);

		// should match the end of the region
		expect(findInlineMatch(testDoc, spec, fullSel, MatchSide.End)).toBe(1);
	});

	const listSpec: RegionSpec = {
		template: { start: ' - ', end: '' },
		matcher: {
			start: /^\s*[-*]\s/g,
			end: /$/g,
		},
	};

	it('matching a custom list: should not match a list if not within the selection', () => {
		const doc = DocumentText.of(['- Test...']);
		const sel = EditorSelection.range(1, 6);

		// Beginning of list not selected: no match
		expect(findInlineMatch(doc, listSpec, sel, MatchSide.Start)).toBe(-1);
	});

	it('matching a custom list: should match start of selected, unindented list', () => {
		const doc = DocumentText.of(['- Test...']);
		const sel = EditorSelection.range(0, 6);

		expect(findInlineMatch(doc, listSpec, sel, MatchSide.Start)).toBe(2);
	});

	it('matching a custom list: should match start of indented list', () => {
		const doc = DocumentText.of(['   - Test...']);
		const sel = EditorSelection.range(0, 6);

		expect(findInlineMatch(doc, listSpec, sel, MatchSide.Start)).toBe(5);
	});

	it('matching a custom list: should match the end of an item in an indented list', () => {
		const doc = DocumentText.of(['   - Test...']);
		const sel = EditorSelection.range(0, 6);

		// Zero-length, but found, selection
		expect(findInlineMatch(doc, listSpec, sel, MatchSide.End)).toBe(0);
	});

	const multiLineTestText = `Internal text manipulation
		This is a test...
		of block and inline region toggling.`;
	const codeFenceRegex = /^``````\w*\s*$/;
	const inlineCodeRegionSpec = RegionSpec.of({
		template: '`',
		nodeName: 'InlineCode',
	});
	const blockCodeRegionSpec: RegionSpec = {
		template: { start: '``````', end: '``````' },
		matcher: { start: codeFenceRegex, end: codeFenceRegex },
	};

	it('should create an empty inline region around the cursor, if given an empty selection', () => {
		const initialState: EditorState = EditorState.create({
			doc: multiLineTestText,
			selection: EditorSelection.cursor(0),
		});

		const changes = toggleRegionFormatGlobally(
			initialState, inlineCodeRegionSpec, blockCodeRegionSpec,
		);

		const newState = initialState.update(changes).state;
		expect(newState.doc.toString()).toEqual(`\`\`${multiLineTestText}`);
	});

	it('should wrap multiple selected lines in block formatting', () => {
		const initialState: EditorState = EditorState.create({
			doc: multiLineTestText,
			selection: EditorSelection.range(0, multiLineTestText.length),
		});

		const changes = toggleRegionFormatGlobally(
			initialState, inlineCodeRegionSpec, blockCodeRegionSpec,
		);

		const newState = initialState.update(changes).state;
		const editorText = newState.doc.toString();
		expect(editorText).toBe(`\`\`\`\`\`\`\n${multiLineTestText}\n\`\`\`\`\`\``);
		expect(newState.selection.main.from).toBe(0);
		expect(newState.selection.main.to).toBe(editorText.length);
	});

	it('should convert tabs to spaces based on indentUnit', () => {
		const state: EditorState = EditorState.create({
			doc: multiLineTestText,
			selection: EditorSelection.cursor(0),
			extensions: [
				indentUnit.of('    '),
			],
		});
		expect(tabsToSpaces(state, '\t')).toBe('    ');
		expect(tabsToSpaces(state, '\t  ')).toBe('      ');
		expect(tabsToSpaces(state, '  \t  ')).toBe('      ');
	});

	it('should correctly renumber a list with multiple selections', async () => {
		const firstListText = [
			'1. This',
			'\t2. is',
			'\t3. a',
			'4. test',
			'',
			'',
		].join('\n');

		const secondListText = [
			'## List 2',
			'',
			'1. Test',
			'\t2. 2',
		].join('\n');

		const editor = await createTestEditor(
			`${firstListText}${secondListText}\n\n# End`,
			EditorSelection.cursor(firstListText.length + secondListText.length),
			['OrderedList', 'ATXHeading1', 'ATXHeading2'],
		);

		// Include a selection twice in the same list -- previously,
		const initialSelection = EditorSelection.create([
			EditorSelection.cursor('1. This\n2.'.length), // Middle of second line
			EditorSelection.cursor('1. This\n2. is\n3'.length), // Beginning of third line
			EditorSelection.cursor(firstListText.length + secondListText.length - 1), // End
		]);

		editor.dispatch({
			selection: initialSelection,
		});

		editor.dispatch(renumberSelectedLists(editor.state));

		expect(editor.state.doc.toString()).toBe([
			'1. This',
			'\t1. is',
			'\t2. a',
			'2. test',
			'',
			'## List 2',
			'',
			'1. Test',
			'\t1. 2',
			'',
			'# End',
		].join('\n'));
	});
});
