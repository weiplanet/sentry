import React from 'react';
import ReactSelect, {components, OptionProps} from 'react-select';
import styled from '@emotion/styled';

import SelectControl from 'app/components/forms/selectControl';
import space from 'app/styles/space';

type SelectControlProps = React.ComponentProps<typeof SelectControl>;

type Props = Pick<
  SelectControlProps,
  'value' | 'placeholder' | 'name' | 'onChange' | 'options'
>;

class SelectField extends React.Component<Props> {
  componentDidMount() {
    if (!this.selectRef.current) {
      return;
    }

    if (this.selectRef.current?.select?.inputRef) {
      // @ts-ignore The react-select types have inputRef as any.
      this.selectRef.current.select.inputRef.autocomplete = 'off';
    }
  }

  selectRef = React.createRef<ReactSelect>();

  render() {
    return (
      <SelectControl
        {...this.props}
        isSearchable={false}
        styles={{
          control: (provided: {[x: string]: string | number | boolean}) => ({
            ...provided,
            minHeight: '41px',
            height: '41px',
          }),
        }}
        ref={this.selectRef}
        components={{
          Option: ({
            data: {label, description, ...data},
            isSelected,
            ...props
          }: OptionProps<{
            label: React.ReactNode;
            value: string;
            description?: string;
          }>) => (
            <components.Option isSelected={isSelected} data={data} {...props}>
              <Wrapper isSelected={isSelected}>
                <div data-test-id="label">{label}</div>
                {description && <Description>{`(${description})`}</Description>}
              </Wrapper>
            </components.Option>
          ),
        }}
        openOnFocus
      />
    );
  }
}

export default SelectField;

const Description = styled('div')`
  color: ${p => p.theme.gray300};
`;

const Wrapper = styled('div')<{isSelected?: boolean}>`
  display: grid;
  grid-template-columns: 1fr auto;
  grid-gap: ${space(1)};
  ${p =>
    p.isSelected &&
    `
      ${Description} {
        :not(:hover) {
          color: ${p.theme.white};
        }
      }
    `}
`;
