/* eslint-disable no-underscore-dangle */
import { addons, useEffect } from '@storybook/preview-api';
import type { ArgTypes, Args, StoryContext, Renderer } from '@storybook/types';

import { SourceType, SNIPPET_RENDERED } from '@storybook/docs-tools';

import { format } from 'prettier';
// import parserTypescript from 'prettier/parser-typescript';
import parserHTML from 'prettier/parser-html.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import { isArray } from '@vue/shared';

type ArgEntries = [string, any][];
type Attribute = {
  name: string;
  value: string;
  sourceSpan?: any;
  valueSpan?: any;
  nameSpan?: any;
  i18n?: any;
  type: string;
  namespace: any;
  hasExplicitNamespace: boolean;
} & Record<string, any>;
/**
 * Check if the sourcecode should be generated.
 *
 * @param context StoryContext
 */
const skipSourceRender = (context: StoryContext<Renderer>) => {
  const sourceParams = context?.parameters.docs?.source;
  const isArgsStory = context?.parameters.__isArgsStory;

  // always render if the user forces it
  if (sourceParams?.type === SourceType.DYNAMIC) {
    return false;
  }

  // never render if the user is forcing the block to render code, or
  // if the user provides code, or if it's not an args story.
  return !isArgsStory || sourceParams?.code || sourceParams?.type === SourceType.CODE;
};

/**
 * Extract a component name.
 *
 * @param component Component
 */
function getComponentNameAndChildren(component: any): {
  name: string | null;
  children: any;
  attributes: any;
} {
  return {
    name: component?.name || component?.__name || component?.__docgenInfo?.__name || null,
    children: component?.children || null,
    attributes: component?.attributes || component?.attrs || null,
  };
}
/**
 * Transform args to props string
 * @param args
 * @param argTypes
 * @param slotProp prop used to simulate slot
 */
function argsToSource(args: Args, argTypes: ArgTypes, byRef?: boolean): string {
  const argsKeys = Object.keys(args).filter(
    (key: any) => ['props', 'events'].indexOf(argTypes[key]?.table?.category) !== -1 // remove slots and children
  );
  const source = argsKeys
    .map((key) =>
      propToDynamicSource(byRef ? `:${key}` : key, byRef ? key : args[key], argTypes[key])
    )
    .filter((item) => item !== '')
    .join(' ');

  return source;
}

function propToDynamicSource(
  key: string,
  value: Args[keyof Args],
  argType: ArgTypes[keyof ArgTypes]
): string {
  // slot Args or default value
  // default value ?
  if (!value) {
    return '';
  }

  if (value === true) {
    return key;
  }

  if (typeof value === 'string') {
    return `${key}='${value}'`;
  }

  if (typeof value === 'function' || argType?.table?.category === 'events') {
    return `@${key}='()=>{}'`;
  }

  return `:${key}='${JSON.stringify(value)}'`;
}
/**
 *
 * @param args generate script setup from args
 * @param argTypes
 */
function generateScriptSetup(args: Args, argTypes: ArgTypes, components: any[]): string {
  const scriptLines = Object.keys(args).map(
    (key: any) =>
      `const ${key} = ${
        typeof args[key] === 'function' ? `()=>{}` : `ref(${JSON.stringify(args[key])})`
      }`
  );
  scriptLines.unshift(`import { ref } from "vue"`);

  return `<script setup>${scriptLines.join('\n')}</script>`;
}
/**
 * get component templates one or more
 * @param renderFn
 */
function getTemplates(renderFn: any): [] {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const ast = parserHTML.parsers.vue.parse(renderFn.toString());
    console.log(ast);
    let components = ast.children?.filter(
      ({ name: _name = '', type: _type = '' }) =>
        _name && !['template', 'script', 'style', 'slot'].includes(_name) && _type === 'element'
    );
    if (!isArray(components)) {
      return [];
    }
    components = components.map(
      ({ attrs: attributes = [], name: Name = '', children: Children = [] }) => {
        console.log(' attributes ', attributes);
        return {
          name: Name,
          attrs: attributes?.filter((el: any) => el.name !== 'vvv-bind'),
          children: Children,
        };
      }
    );
    return components;
  } catch (e) {
    console.error(e);
  }
  return [];
}

/**
 * Generate a vue3 template.
 *
 * @param component Component
 * @param args Args
 * @param argTypes ArgTypes
 * @param slotProp Prop used to simulate a slot
 */
export function generateSource(
  compOrComps: any,
  args: Args,
  argTypes: ArgTypes,
  byRef?: boolean | undefined
): string | null {
  if (!compOrComps) return null;
  const generateComponentSource = (component: any): string | null => {
    const { name, children, attributes } = getComponentNameAndChildren(component);

    if (!name) {
      return '';
    }
    console.log(attributes, ' ---- attributes');
    console.log(args, '------ args');
    const argsIn = attributes ? getArgsInAttrs(args, attributes) : args; // keep only args that are in attributes
    const props = argsToSource(argsIn, argTypes, byRef);
    const slotArgs = Object.entries(argsIn).filter(
      ([arg]) => argTypes[arg]?.table?.category === 'slots'
    );
    const slotProps = Object.entries(argTypes).filter(
      ([arg]) => argTypes[arg]?.table?.category === 'slots'
    );
    if (slotArgs && slotArgs.length > 0) {
      const namedSlotContents = createNamedSlots(slotArgs, slotProps, byRef);
      return `<${name} ${props}>\n${namedSlotContents}\n</${name}>`;
    }

    if (children && children.length > 0) {
      const childrenSource = children.map((child: any) => {
        return generateSource(
          typeof child.value === 'string' ? getTemplates(child.value) : child.value,
          args,
          argTypes,
          byRef
        );
      });

      if (childrenSource.join('').trim() === '') return `<${name} ${props}/>`;

      const isNativeTag =
        name.includes('template') ||
        name.match(/^[a-z]/) ||
        (name === 'Fragment' && !name.includes('-'));

      return `<${name} ${isNativeTag ? '' : props}>\n${childrenSource}\n</${name}>`;
    }

    return `<${name} ${props}/>`;
  };
  // get one component or multiple
  const components = isArray(compOrComps) ? compOrComps : [compOrComps];

  const source = Object.keys(components)
    .map((key: any) => `${generateComponentSource(components[key])}`)
    .join(`\n`);
  return source;
}

/**
 * create Named Slots content in source
 * @param slotProps
 * @param slotArgs
 */

function createNamedSlots(slotArgs: ArgEntries, slotProps: ArgEntries, byRef?: boolean) {
  if (!slotArgs) return '';
  const many = slotProps.length > 1;
  return slotArgs
    .map(([key, value]) => {
      const content = !byRef ? JSON.stringify(value) : `{{ ${key} }}`;
      return many ? `  <template #${key}>${content}</template>` : `  ${content}`;
    })
    .join('\n');
}

function getArgsInAttrs(args: Args, attributes: Attribute[]) {
  return Object.keys(args).reduce((acc, prop) => {
    if (attributes?.find((attr: any) => attr.name === 'v-bind')) {
      acc[prop] = args[prop];
    }
    const attribute = attributes?.find(
      (attr: any) => attr.name === prop || attr.name === `:${prop}`
    );
    if (attribute) {
      acc[prop] = attribute.name === `:${prop}` ? args[prop] : attribute.value;
    }
    return acc;
  }, {} as Record<string, any>);
}

/**
 * format prettier for vue
 * @param source
 */

function prettierFormat(source: string): string {
  try {
    return format(source, {
      vueIndentScriptAndStyle: true,
      parser: 'vue',
      plugins: [parserHTML],
      singleQuote: true,
      quoteProps: 'preserve',
    });
  } catch (e: any) {
    console.error(e.toString());
  }
  return source;
}

/**
 *  source decorator.
 * @param storyFn Fn
 * @param context  StoryContext
 */
export const sourceDecorator = (storyFn: any, context: StoryContext<Renderer>) => {
  const channel = addons.getChannel();
  const skip = skipSourceRender(context);
  const story = storyFn();

  let source: string;

  useEffect(() => {
    if (!skip && source) {
      channel.emit(SNIPPET_RENDERED, (context || {}).id, source);
    }
  });

  if (skip) {
    return story;
  }

  const { args = {}, component: ctxtComponent, argTypes = {} } = context || {};
  const components = getTemplates(context?.originalStoryFn);

  const storyComponent = components.length ? components : ctxtComponent;
  console.log('--->context', context);
  console.log('storyComponent', storyComponent);
  const withScript = context?.parameters?.docs?.source?.withScriptSetup || false;
  const generatedScript = withScript ? generateScriptSetup(args, argTypes, components) : '';
  const generatedTemplate = generateSource(storyComponent, args, argTypes, withScript);

  if (generatedTemplate) {
    source = prettierFormat(`${generatedScript}\n <template>\n ${generatedTemplate} \n</template>`);
  }

  return story;
};
