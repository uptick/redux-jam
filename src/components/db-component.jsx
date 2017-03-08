import React, {Component} from 'react';
import {bindActionCreators} from 'redux';
import {connect} from 'react-redux';

import * as modelActions from '../actions';
import DB from '../db';

/**
 * Higher-order component to automatically insert models loaded
 * from a server.
 */
export default (ComposedComponent, options) => {

  /**
   * Connect the wrapper component to the model state.
   */
  return connect(

    state => {
      const {name, schema} = options || {};
      const {model = {}} = state;
      const {views = {}} = model;
      const db = new DB( model.db, {schema} );
      const content = views[name] || {};
      return {
        ...content,
        db
      };
    },

    dispatch => bindActionCreators( modelActions, dispatch )

  )(

    class DBComponent extends Component {

      constructor( props ) {
        super( props );
        this.reload = ::this.reload;
      }

      reload( props ) {
        console.debug( 'DBComponent: Loading.' );
        props.loadModelView( {...options, props} );
      }

      componentWillMount() {
        this.reload( this.props );
      }

      componentWillUnmount() {
        this.props.clearModelView( options );
      }

      componentWillReceiveProps( nextProps ) {
        if( this.props.params != nextProps.params )
          this.reload( nextProps );
      }

      render() {
        return (
          <ComposedComponent
              {...this.props}
          />
        );
      }
    }

  );

}
